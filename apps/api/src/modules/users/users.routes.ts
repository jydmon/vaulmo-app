import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, tenants } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../middleware/error';
import { publicUser } from '../auth/auth.routes';

export const usersRouter = Router();
usersRouter.use(requireAuth);

// The authenticated user's own profile + effective roles/permissions.
usersRouter.get('/me', async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!user) throw new AppError(404, 'not_found', 'User not found');
  let tenant = null;
  if (user.tenantId) {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
    if (t) tenant = { id: t.id, name: t.name, plan: t.plan, status: t.status };
  }
  res.json({
    ...publicUser(user),
    tenant,
    roles: req.auth!.roles,
    permissions: req.auth!.perms,
    mfaSatisfied: req.auth!.mfa,
  });
});
