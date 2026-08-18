import type { Request, Response, NextFunction } from 'express';
import type { PermissionKey } from '../lib/permissions';
import { audit } from '../lib/audit';

// Requires the authenticated user to hold ALL of the given permissions.
export function requirePermission(...required: PermissionKey[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const perms = req.auth?.perms ?? [];
    const ok = required.every((p) => perms.includes(p));
    if (!ok) {
      void audit({
        action: 'authz.denied',
        actorId: req.auth?.sub,
        tenantId: req.auth?.tid ?? null,
        outcome: 'failure',
        metadata: { required, path: req.path },
        req,
      });
      res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

// Requires the user to hold at least ONE of the given permissions.
export function requireAnyPermission(...required: PermissionKey[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const perms = req.auth?.perms ?? [];
    if (!required.some((p) => perms.includes(p))) {
      res.status(403).json({ error: 'forbidden', message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
