import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, tenants, auditLogs, dsrRequests, consentRecords, documents, reminders, trips, purchases, trackedSubscriptions, familyMembers, nextOfKin } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { verifyPassword } from '../../lib/password';
import { entitlementsFor } from '../../lib/billing/service';
import { CURRENT_TERMS_VERSION } from '../../lib/legal';
import { publicUser } from '../auth/auth.routes';

export const usersRouter = Router();
usersRouter.use(requireAuth);

async function meResponse(userId: string, req: any) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'not_found', 'User not found');
  let tenant = null;
  if (user.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
    if (t) tenant = { id: t.id, name: t.name, plan: t.plan, status: t.status, country: (t as any).country ?? null };
  }
  const isSuper = (req.auth!.roles ?? []).includes('super_admin');
  // Onboarding gate state (staff/super-admins bypass the whole flow).
  let planSelected = isSuper;
  if (!isSuper && user.tenantId) {
    const ent = await entitlementsFor(user.tenantId);
    planSelected = ['active', 'trialing', 'past_due'].includes(String(ent.status));
  }
  const termsAccepted = isSuper || (!!user.termsAcceptedAt && user.termsVersion === CURRENT_TERMS_VERSION);
  const onboarding = {
    emailVerified: isSuper || user.emailVerified,
    termsAccepted,
    termsVersion: CURRENT_TERMS_VERSION,
    planSelected,
    tourSeen: isSuper || !!user.tourSeenAt,
    twoFactor: user.mfaEnabled,
    // The whole first-run flow is complete once the mandatory gates are satisfied.
    complete: (isSuper || user.emailVerified) && termsAccepted && planSelected,
  };
  return {
    ...publicUser(user),
    emailVerified: user.emailVerified,
    phone: user.phone ?? null,
    timezone: user.timezone ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    tenant,
    onboarding,
    roles: req.auth!.roles,
    permissions: req.auth!.perms,
    mfaSatisfied: req.auth!.mfa,
  };
}

// The authenticated user's own profile + effective roles/permissions.
usersRouter.get('/me', async (req, res) => {
  res.json(await meResponse(req.auth!.sub, req));
});

// Onboarding: accept the current Terms of Business (required before using the platform).
// Records the acceptance on the user + a consent record for the audit trail.
usersRouter.post('/me/accept-terms', async (req, res) => {
  await db.update(users).set({ termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION, updatedAt: new Date() }).where(eq(users.id, req.auth!.sub));
  await db.insert(consentRecords).values({ userId: req.auth!.sub, policy: 'terms', version: CURRENT_TERMS_VERSION, ip: req.ip ?? null });
  await audit({ action: 'onboarding.terms_accepted', actorId: req.auth!.sub, tenantId: req.auth!.tid ?? null, metadata: { version: CURRENT_TERMS_VERSION }, req });
  res.json(await meResponse(req.auth!.sub, req));
});

// Onboarding: mark the platform tour as seen (Skip / Don't show again / finished).
usersRouter.post('/me/tour-seen', async (req, res) => {
  await db.update(users).set({ tourSeenAt: new Date(), updatedAt: new Date() }).where(eq(users.id, req.auth!.sub));
  await audit({ action: 'onboarding.tour_seen', actorId: req.auth!.sub, tenantId: req.auth!.tid ?? null, req });
  res.json({ ok: true });
});

// Update your own profile (ACC-07): name, phone, timezone; country is on the household.
// Email changes go through verification separately.
const profileSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  country: z.string().length(2).optional(),
});
usersRouter.put('/me', async (req, res) => {
  const b = profileSchema.parse(req.body);
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.fullName !== undefined) set.fullName = b.fullName;
  if (b.phone !== undefined) set.phone = b.phone;
  if (b.timezone !== undefined) set.timezone = b.timezone;
  await db.update(users).set(set).where(eq(users.id, req.auth!.sub));
  if (b.country && req.auth!.tid) {
    await db.update(tenants).set({ country: b.country.toUpperCase(), updatedAt: new Date() }).where(eq(tenants.id, req.auth!.tid));
  }
  await audit({ action: 'user.profile.updated', actorId: req.auth!.sub, tenantId: req.auth!.tid ?? null, req });
  res.json(await meResponse(req.auth!.sub, req));
});

/* ============================================================================
 * Privacy & Security Centre (SEC-16/17/18/19/20/21) — user-facing, self-serve.
 * ==========================================================================*/

// Security-relevant actions we surface to the user (their own account activity).
const SECURITY_ACTIONS = [
  'auth.login', 'auth.login.success', 'auth.login.mfa_challenge', 'auth.mfa.verify',
  'auth.reset.requested', 'auth.reset.success', 'auth.session.revoked', 'auth.session.revoked_others',
  'mfa.enabled', 'mfa.disabled', 'mfa.enroll.begin', 'user.profile.updated',
  'document.downloaded', 'document.deleted',
  'emergency.owner.approve', 'emergency.owner.decline', 'emergency.revoked',
  'privacy.export', 'privacy.deletion_requested', 'privacy.consent',
];

// SEC-17/21: recent security activity on the user's own account.
usersRouter.get('/me/security-activity', async (req, res) => {
  const rows = await db.select().from(auditLogs)
    .where(and(eq(auditLogs.actorId, req.auth!.sub), inArray(auditLogs.action, SECURITY_ACTIONS)))
    .orderBy(desc(auditLogs.at)).limit(50);
  res.json({ activity: rows.map((r) => ({ id: r.id, action: r.action, at: r.at, ip: r.ip, outcome: r.outcome, userAgent: r.userAgent })) });
});

// SEC-16/20: privacy overview — consents on record + open data requests.
usersRouter.get('/me/privacy', async (req, res) => {
  const consents = await db.select().from(consentRecords).where(eq(consentRecords.userId, req.auth!.sub)).orderBy(desc(consentRecords.acceptedAt));
  const [me] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  const requests = me ? await db.select().from(dsrRequests).where(eq(dsrRequests.subjectEmail, me.email)).orderBy(desc(dsrRequests.createdAt)).limit(20) : [];
  res.json({
    consents: consents.map((c) => ({ id: c.id, policy: c.policy, version: c.version, acceptedAt: c.acceptedAt })),
    requests: requests.map((r) => ({ id: r.id, type: r.type, status: r.status, requestedBy: r.requestedBy, createdAt: r.createdAt, completedAt: r.completedAt })),
  });
});

// SEC-20: record a consent (e.g. accept a policy version, opt in/out of marketing).
const consentSchema = z.object({ policy: z.enum(['terms', 'privacy', 'cookie', 'marketing']), version: z.string().min(1).max(40) });
usersRouter.post('/me/consent', async (req, res) => {
  const b = consentSchema.parse(req.body);
  const [row] = await db.insert(consentRecords).values({ userId: req.auth!.sub, policy: b.policy, version: b.version, ip: req.ip ?? null }).returning();
  await audit({ action: 'privacy.consent', actorId: req.auth!.sub, tenantId: req.auth!.tid ?? null, metadata: { policy: b.policy, version: b.version }, req });
  res.status(201).json({ consent: { id: row.id, policy: row.policy, version: row.version, acceptedAt: row.acceptedAt } });
});

// SEC-18: self-serve data export. Builds a portable JSON bundle of the user's own
// data right now, and logs the request in dsr_requests for the audit trail.
usersRouter.post('/me/export', async (req, res) => {
  const [me] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!me) throw new AppError(404, 'not_found', 'User not found');
  const tenantId = req.auth!.tid ?? null;
  const bundle: Record<string, any> = {
    exportedAt: new Date().toISOString(),
    account: { id: me.id, email: me.email, fullName: me.fullName, phone: me.phone, timezone: me.timezone, createdAt: me.createdAt },
  };
  if (tenantId) {
    const [docs, rems, tr, pu, subs, mem, nok] = await Promise.all([
      db.select().from(documents).where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt))),
      db.select().from(reminders).where(eq(reminders.tenantId, tenantId)),
      db.select().from(trips).where(eq(trips.tenantId, tenantId)),
      db.select().from(purchases).where(eq(purchases.tenantId, tenantId)),
      db.select().from(trackedSubscriptions).where(eq(trackedSubscriptions.tenantId, tenantId)),
      db.select().from(familyMembers).where(eq(familyMembers.tenantId, tenantId)),
      db.select().from(nextOfKin).where(eq(nextOfKin.tenantId, tenantId)),
    ]);
    // Documents: metadata only (not the file bytes or raw OCR text) in the JSON bundle.
    bundle.documents = docs.map((d) => ({ id: d.id, title: d.title, typeKey: d.typeKey, status: d.status, confirmedMetadata: d.confirmedMetadata, subjectMemberId: d.subjectMemberId, createdAt: d.createdAt }));
    bundle.reminders = rems.map((r) => ({ id: r.id, title: r.title, dueDate: r.dueDate, status: r.status, recurrence: r.recurrence }));
    bundle.trips = tr;
    bundle.purchases = pu;
    bundle.subscriptions = subs;
    bundle.familyMembers = mem;
    bundle.nextOfKin = nok.map((n) => ({ id: n.id, name: n.name, email: n.email, relationship: n.relationship, status: n.status }));
  }
  await db.insert(dsrRequests).values({ userId: me.id, tenantId, subjectEmail: me.email, type: 'export', status: 'completed', requestedBy: 'self', completedAt: new Date() });
  await audit({ action: 'privacy.export', actorId: me.id, tenantId, req });
  res.setHeader('content-disposition', 'attachment; filename="vaulmo-data-export.json"');
  res.json(bundle);
});

// SEC-19 + ACC-05: request account deletion. Requires a fresh password check
// (step-up). We NEVER hard-delete here — this raises a verified request that is
// handled with due process; documents are not auto-deleted (SEC-15).
const deletionSchema = z.object({ password: z.string().min(1), reason: z.string().max(500).optional() });
usersRouter.post('/me/deletion-request', async (req, res) => {
  const b = deletionSchema.parse(req.body);
  const [me] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!me) throw new AppError(404, 'not_found', 'User not found');
  const ok = await verifyPassword(b.password, me.passwordHash);
  if (!ok) throw new AppError(403, 'password_incorrect', 'Password is incorrect');
  // Avoid duplicate open requests.
  const existing = await db.select().from(dsrRequests)
    .where(and(eq(dsrRequests.subjectEmail, me.email), eq(dsrRequests.type, 'deletion'), inArray(dsrRequests.status, ['pending', 'in_progress'])));
  if (existing.length) { res.json({ request: { id: existing[0].id, status: existing[0].status }, alreadyOpen: true }); return; }
  const [row] = await db.insert(dsrRequests).values({ userId: me.id, tenantId: req.auth!.tid ?? null, subjectEmail: me.email, type: 'deletion', status: 'pending', requestedBy: 'self', reason: b.reason ?? null }).returning();
  await audit({ action: 'privacy.deletion_requested', actorId: me.id, tenantId: req.auth!.tid ?? null, targetType: 'dsr', targetId: row.id, req });
  res.status(201).json({ request: { id: row.id, status: row.status, type: row.type, createdAt: row.createdAt } });
});
