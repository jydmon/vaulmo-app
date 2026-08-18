import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { ROLES } from '../lib/permissions';

// Phase 2/3 features are limited to internal testers (and platform staff) during
// the internal-alpha stage. Super Admins always pass; everyone else must have the
// is_internal_tester flag on their account.
export async function requireInternalTester(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.auth?.roles?.includes(ROLES.SUPER_ADMIN)) return next();
  const [u] = await db
    .select({ it: users.isInternalTester })
    .from(users)
    .where(eq(users.id, req.auth!.sub))
    .limit(1);
  if (u?.it) return next();
  res.status(403).json({
    error: 'not_internal_tester',
    message: 'This feature is limited to internal testers during alpha',
  });
}
