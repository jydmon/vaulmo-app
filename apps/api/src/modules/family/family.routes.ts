import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { familyMembers, nextOfKin } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { newRefreshToken, hashToken } from '../../lib/jwt';

const RECONFIRM_DAYS = 90; // quarterly

export const familyRouter = Router();
familyRouter.use(requireAuth, requireMfaSatisfied);
const tid = (req: any): string => {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have a family');
  return req.auth.tid;
};

// ---- Family members / dependants ----
familyRouter.get('/members', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  res.json({ members: await db.select().from(familyMembers).where(eq(familyMembers.tenantId, tid(req))) });
});
const memberSchema = z.object({ name: z.string().min(1), relationship: z.string().optional(), isDependant: z.boolean().optional(), dateOfBirth: z.string().optional() });
familyRouter.post('/members', requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  const b = memberSchema.parse(req.body);
  const [row] = await db.insert(familyMembers).values({ tenantId: tid(req), name: b.name, relationship: b.relationship, isDependant: b.isDependant ?? false, dateOfBirth: b.dateOfBirth }).returning();
  await audit({ action: 'family.member.added', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'family_member', targetId: row.id, req });
  res.status(201).json({ member: row });
});

// ---- Next of kin ----
familyRouter.get('/nok', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const rows = await db.select().from(nextOfKin).where(eq(nextOfKin.tenantId, tid(req))).orderBy(desc(nextOfKin.createdAt));
  res.json({ nextOfKin: rows.map((r) => ({ ...r, inviteTokenHash: undefined })) });
});

const nomSchema = z.object({ name: z.string().min(1), email: z.string().email(), relationship: z.string().optional(), permissions: z.record(z.any()).optional() });
familyRouter.post('/nok', requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  const b = nomSchema.parse(req.body);
  const [row] = await db.insert(nextOfKin).values({ tenantId: tid(req), name: b.name, email: b.email.toLowerCase(), relationship: b.relationship, permissions: (b.permissions ?? {}) as any, status: 'nominated' }).returning();
  await audit({ action: 'nok.nominated', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'nok', targetId: row.id, req });
  res.status(201).json({ nok: { ...row, inviteTokenHash: undefined } });
});

// Invite the NOK — issues a one-time token (emailed in prod; returned here for dev).
familyRouter.post('/nok/:id/invite', requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  const [nok] = await db.select().from(nextOfKin).where(and(eq(nextOfKin.id, req.params.id), eq(nextOfKin.tenantId, tid(req)))).limit(1);
  if (!nok) throw new AppError(404, 'not_found', 'Next of kin not found');
  const { token, hash } = newRefreshToken();
  await db.update(nextOfKin).set({ status: 'invited', inviteTokenHash: hash, invitedAt: new Date() }).where(eq(nextOfKin.id, nok.id));
  await audit({ action: 'nok.invited', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'nok', targetId: nok.id, req });
  res.json({ inviteToken: token }); // in production this is emailed to the NOK, not returned
});

familyRouter.post('/nok/:id/reconfirm', requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  const now = new Date();
  const [row] = await db.update(nextOfKin)
    .set({ lastReconfirmedAt: now, reconfirmDueAt: new Date(now.getTime() + RECONFIRM_DAYS * 86400000) })
    .where(and(eq(nextOfKin.id, req.params.id), eq(nextOfKin.tenantId, tid(req)))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Next of kin not found');
  await audit({ action: 'nok.reconfirmed', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'nok', targetId: row.id, req });
  res.json({ nok: { ...row, inviteTokenHash: undefined } });
});

familyRouter.post('/nok/:id/revoke', requirePermission(PERMISSIONS.MEMBER_MANAGE), async (req, res) => {
  const [row] = await db.update(nextOfKin).set({ status: 'revoked' }).where(and(eq(nextOfKin.id, req.params.id), eq(nextOfKin.tenantId, tid(req)))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Next of kin not found');
  await audit({ action: 'nok.revoked', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'nok', targetId: row.id, req });
  res.json({ ok: true });
});

// ---- Public: the NOK accepts the invitation (they are not a Vaulmo user) ----
export const nokPublicRouter = Router();
const acceptSchema = z.object({ token: z.string().min(10) });
nokPublicRouter.post('/accept', async (req, res) => {
  const { token } = acceptSchema.parse(req.body);
  const hash = hashToken(token);
  const [nok] = await db.select().from(nextOfKin).where(eq(nextOfKin.inviteTokenHash, hash)).limit(1);
  if (!nok) throw new AppError(404, 'invalid_token', 'Invalid or expired invitation');
  const now = new Date();
  await db.update(nextOfKin).set({ status: 'confirmed', confirmedAt: now, lastReconfirmedAt: now, reconfirmDueAt: new Date(now.getTime() + RECONFIRM_DAYS * 86400000), inviteTokenHash: null }).where(eq(nextOfKin.id, nok.id));
  await audit({ action: 'nok.confirmed', tenantId: nok.tenantId, targetType: 'nok', targetId: nok.id, metadata: { email: nok.email }, req });
  res.json({ status: 'confirmed', tenantId: nok.tenantId });
});
