import type { Request, Response, NextFunction } from 'express';
import { entitlementsFor } from '../lib/billing/service';

// Gate a route behind a plan module. Super admins always pass. Tenants pass when
// their active plan includes the module (an uncurated plan = all modules, so this
// only restricts once an admin selects modules for a plan).
export function requireModule(moduleKey: string) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    if ((req.auth?.roles ?? []).includes('super_admin')) return next();
    const tid = req.auth?.tid;
    if (!tid) return next(); // non-tenant contexts are handled by their own guards
    try {
      const ent = await entitlementsFor(tid);
      const modules: string[] = (ent as any).modules ?? [];
      if (modules.includes(moduleKey)) return next();
      res.status(402).json({ error: 'feature_not_in_plan', message: 'This feature is not included in your current plan.', module: moduleKey });
    } catch {
      // If entitlements can't be resolved, fail open rather than block the user.
      next();
    }
  };
}
