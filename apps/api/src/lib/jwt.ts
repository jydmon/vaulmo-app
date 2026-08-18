import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../env';

export interface AccessTokenClaims {
  sub: string; // user id
  tid: string | null; // tenant id (null for super admin)
  roles: string[];
  perms: string[];
  mfa: boolean; // whether MFA has been satisfied on this session
  sid?: string; // session id this token was issued for (for device/session management)
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'lifehub',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'lifehub' }) as AccessTokenClaims;
}

// Refresh tokens are opaque random strings. We store only their hash.
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
