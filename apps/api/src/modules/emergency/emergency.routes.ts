import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { emergencyRequests, nextOfKin, users, documents } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission, requireAnyPermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';

// A Super Admin or a Security Reviewer may see and act on all emergency-access cases.
const canReview = (req: any) => req.auth?.roles?.includes('super_admin') || req.auth?.perms?.includes(PERMISSIONS.SECURITY_REVIEW);
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';

const PENDING_DAYS = 7;
// Feature flag — Emergency Access ships "coming soon" until the legal process, identity
// verification and operating procedures are defined. Read at request time so it can be
// enabled per environment without a redeploy.
const emergencyEnabled = () => process.env.EMERGENCY_ACCESS_ENABLED === 'true';

// ---------- Public (the requester is a next of kin, not a user) ----------
export const emergencyPublicRouter = Router();

emergencyPublicRouter.get('/status', (_req, res) => {
  res.json({ enabled: emergencyEnabled(), message: emergencyEnabled() ? 'Emergency Access is available' : 'Emergency Access coming soon' });
});

const reqSchema = z.object({ tenantId: z.string().uuid(), requesterEmail: z.string().email(), reason: z.string().max(1000).optional() });
emergencyPublicRouter.post('/request', async (req, res) => {
  if (!emergencyEnabled()) {
    res.status(403).json({ error: 'coming_soon', message: 'Emergency Access coming soon' });
    return;
  }
  const b = reqSchema.parse(req.body);
  // Only a CONFIRMED next of kin for that account may request emergency access.
  const [nok] = await db.select().from(nextOfKin)
    .where(and(eq(nextOfKin.tenantId, b.tenantId), eq(nextOfKin.email, b.requesterEmail.toLowerCase()), eq(nextOfKin.status, 'confirmed'))).limit(1);
  if (!nok) throw new AppError(403, 'not_authorised', 'No confirmed next-of-kin record matches');

  const now = new Date();
  const [er] = await db.insert(emergencyRequests).values({
    tenantId: b.tenantId, nokId: nok.id, requesterName: nok.name, requesterEmail: nok.email,
    reason: b.reason, status: 'pending', pendingUntil: new Date(now.getTime() + PENDING_DAYS * 86400000),
  }).returning();

  // Alert the account owner immediately.
  const recipients = await db.select().from(users).where(eq(users.tenantId, b.tenantId));
  for (const u of recipients) {
    await notify({ userId: u.id, tenantId: b.tenantId, category: 'system', title: 'Emergency access requested', body: `${nok.name} has requested emergency access. A ${PENDING_DAYS}-day review period has started.`, dedupeKey: `emergency:${er.id}` });
  }
  await audit({ action: 'emergency.requested', tenantId: b.tenantId, targetType: 'emergency', targetId: er.id, metadata: { requester: nok.email }, req });
  res.status(201).json({ requestId: er.id, status: er.status, pendingUntil: er.pendingUntil });
});

// The granted requester reads a RESTRICTED, TEMPORARY view (titles/types only — never
// document contents), valid only while access is active and unexpired.
emergencyPublicRouter.get('/access/:id', async (req, res) => {
  const email = String(req.query.email ?? '').toLowerCase();
  const [er] = await db.select().from(emergencyRequests).where(eq(emergencyRequests.id, req.params.id)).limit(1);
  if (!er || er.requesterEmail !== email) throw new AppError(403, 'not_authorised', 'Not authorised');
  const now = new Date();
  const active = er.status === 'active' && er.accessExpiresAt && er.accessExpiresAt.getTime() > now.getTime() && !er.revokedAt;
  if (!active) throw new AppError(403, 'no_access', 'No active emergency access');

  const scope = (er.accessScope as any) ?? {};
  const cats: string[] | undefined = scope.categories;
  const docs = await db.select().from(documents).where(eq(documents.tenantId, er.tenantId));
  const restricted = docs
    .filter((d) => !cats || (d.typeKey && cats.includes(d.typeKey)))
    .map((d) => ({ title: d.title, typeKey: d.typeKey, status: d.status })); // metadata/contents intentionally excluded
  await audit({ action: 'emergency.access.used', tenantId: er.tenantId, targetType: 'emergency', targetId: er.id, metadata: { email }, req });
  res.json({ scope, expiresAt: er.accessExpiresAt, documents: restricted });
});

// ---------- Owner + Super Admin actions ----------
export const emergencyRouter = Router();
emergencyRouter.use(requireAuth, requireMfaSatisfied);

emergencyRouter.get('/requests', async (req, res) => {
  const isSuper = canReview(req);
  const rows = isSuper
    ? await db.select().from(emergencyRequests).orderBy(desc(emergencyRequests.requestedAt)).limit(200)
    : await db.select().from(emergencyRequests).where(eq(emergencyRequests.tenantId, req.auth!.tid ?? '')).orderBy(desc(emergencyRequests.requestedAt));
  res.json({ requests: rows });
});

// Owner approves or declines.
const ownerSchema = z.object({ decision: z.enum(['approve', 'decline']), note: z.string().max(1000).optional() });
emergencyRouter.post('/requests/:id/owner-decision', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const b = ownerSchema.parse(req.body);
  const [er] = await db.select().from(emergencyRequests).where(and(eq(emergencyRequests.id, req.params.id), eq(emergencyRequests.tenantId, req.auth!.tid ?? ''))).limit(1);
  if (!er) throw new AppError(404, 'not_found', 'Request not found');
  if (er.status !== 'pending') throw new AppError(409, 'bad_state', `Request is ${er.status}`);
  const status = b.decision === 'approve' ? 'owner_approved' : 'owner_declined';
  await db.update(emergencyRequests).set({ ownerDecision: b.decision, ownerDecidedAt: new Date(), status }).where(eq(emergencyRequests.id, er.id));
  await audit({ action: `emergency.owner.${b.decision}`, actorId: req.auth!.sub, tenantId: er.tenantId, targetType: 'emergency', targetId: er.id, req });
  res.json({ status });
});

// Super Admin security review + due diligence → grants restricted, temporary access.
const reviewSchema = z.object({
  decision: z.enum(['approve', 'decline']),
  notes: z.string().max(2000).optional(),
  dueDiligence: z.record(z.any()).optional(),
  accessScope: z.record(z.any()).optional(),
  accessDays: z.number().int().min(1).max(30).optional(),
});
emergencyRouter.post('/requests/:id/security-review', requireAnyPermission(PERMISSIONS.PLATFORM_MANAGE, PERMISSIONS.SECURITY_REVIEW), async (req, res) => {
  const b = reviewSchema.parse(req.body);
  const [er] = await db.select().from(emergencyRequests).where(eq(emergencyRequests.id, req.params.id)).limit(1);
  if (!er) throw new AppError(404, 'not_found', 'Request not found');
  if (er.ownerDecision !== 'approve') throw new AppError(409, 'owner_required', 'Owner has not approved this request');
  if (new Date() < er.pendingUntil) throw new AppError(425, 'pending_period', `The ${PENDING_DAYS}-day pending period has not elapsed`);
  if (!['owner_approved'].includes(er.status)) throw new AppError(409, 'bad_state', `Request is ${er.status}`);

  const now = new Date();
  if (b.decision === 'decline') {
    await db.update(emergencyRequests).set({ status: 'security_declined', securityReviewedBy: req.auth!.sub, securityReviewedAt: now, securityNotes: b.notes, dueDiligence: (b.dueDiligence ?? {}) as any }).where(eq(emergencyRequests.id, er.id));
    await audit({ action: 'emergency.security.declined', actorId: req.auth!.sub, tenantId: er.tenantId, targetType: 'emergency', targetId: er.id, req });
    res.json({ status: 'security_declined' });
    return;
  }
  const days = b.accessDays ?? 7;
  await db.update(emergencyRequests).set({
    status: 'active', securityReviewedBy: req.auth!.sub, securityReviewedAt: now, securityNotes: b.notes,
    dueDiligence: (b.dueDiligence ?? {}) as any, accessScope: (b.accessScope ?? {}) as any,
    accessGrantedAt: now, accessExpiresAt: new Date(now.getTime() + days * 86400000),
  }).where(eq(emergencyRequests.id, er.id));
  await audit({ action: 'emergency.security.approved', actorId: req.auth!.sub, tenantId: er.tenantId, targetType: 'emergency', targetId: er.id, metadata: { days, scope: b.accessScope }, req });
  res.json({ status: 'active', accessExpiresAt: new Date(now.getTime() + days * 86400000) });
});

// Revoke (owner or super admin) — immediate.
emergencyRouter.post('/requests/:id/revoke', async (req, res) => {
  const isSuper = canReview(req);
  const where = isSuper ? eq(emergencyRequests.id, req.params.id) : and(eq(emergencyRequests.id, req.params.id), eq(emergencyRequests.tenantId, req.auth!.tid ?? ''));
  const [row] = await db.update(emergencyRequests).set({ status: 'revoked', revokedAt: new Date() }).where(where).returning();
  if (!row) throw new AppError(404, 'not_found', 'Request not found');
  await audit({ action: 'emergency.revoked', actorId: req.auth!.sub, tenantId: row.tenantId, targetType: 'emergency', targetId: row.id, req });
  res.json({ status: 'revoked' });
});
