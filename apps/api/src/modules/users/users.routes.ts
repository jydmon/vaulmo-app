import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, tenants } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { publicUser } from '../auth/auth.routes';

export const usersRouter = Router();
usersRouter.use(requireAuth);

async function meResponse(userId: string, req: any) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'not_found', 'User not found');
  let tenant = null;
  if (user.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
    if (t) tenant = { id: t.id, name: t.name, plan: t.plan, status: t.status };
  }
  return {
    ...publicUser(user),
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    tenant,
    roles: req.auth!.roles,
    permissions: req.auth!.perms,
    mfaSatisfied: req.auth!.mfa,
  };
}

// The authenticated user's own profile + effective roles/permissions.
usersRouter.get('/me', async (req, res) => {
  res.json(await meResponse(req.auth!.sub, req));
});

// Update your own profile. Name is editable here; email changes go through verification.
const profileSchema = z.object({ fullName: z.string().min(1).max(120) });
usersRouter.put('/me', async (req, res) => {
  const b = profileSchema.parse(req.body);
  await db.update(users).set({ fullName: b.fullName, updatedAt: new Date() }).where(eq(users.id, req.auth!.sub));
  await audit({ action: 'user.profile.updated', actorId: req.auth!.sub, tenantId: req.auth!.tid ?? null, req });
  res.json(await meResponse(req.auth!.sub, req));
});
