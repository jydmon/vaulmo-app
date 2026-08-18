import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

// Verifies the access token and attaches claims to req.auth.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
    return;
  }
  try {
    req.auth = verifyAccessToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}

// Requires that MFA has been satisfied on this session (for MFA-enabled users).
export function requireMfaSatisfied(req: Request, res: Response, next: NextFunction): void {
  if (req.auth && req.auth.mfa === false) {
    res.status(403).json({ error: 'mfa_required', message: 'Complete MFA to continue' });
    return;
  }
  next();
}
