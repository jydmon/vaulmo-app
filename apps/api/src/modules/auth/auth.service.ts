import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { db } from '../../db/client';
import { userRoles, roles, rolePermissions, permissions, sessions, users } from '../../db/schema';
import { signAccessToken, newRefreshToken, hashToken } from '../../lib/jwt';

// Loads a user's roles and flattened permission set via a single join.
export async function loadUserAuthz(userId: string): Promise<{ roles: string[]; perms: string[] }> {
  const roleRows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const permRows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId));

  return {
    roles: [...new Set(roleRows.map((r) => r.key))],
    perms: [...new Set(permRows.map((p) => p.key))],
  };
}

export async function issueSession(opts: {
  userId: string;
  tenantId: string | null;
  roles: string[];
  perms: string[];
  mfaSatisfied: boolean;
  req?: Request;
  refreshTtlDays: number;
}) {
  const { token: refreshToken, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + opts.refreshTtlDays * 86400_000);
  const [session] = await db
    .insert(sessions)
    .values({
      userId: opts.userId,
      refreshHash: hash,
      mfaSatisfied: opts.mfaSatisfied,
      userAgent: opts.req?.get('user-agent') ?? null,
      ip: opts.req?.ip ?? null,
      expiresAt,
    })
    .returning();

  const accessToken = signAccessToken({
    sub: opts.userId,
    tid: opts.tenantId,
    roles: opts.roles,
    perms: opts.perms,
    mfa: opts.mfaSatisfied,
    sid: session.id,
  });
  return { accessToken, refreshToken, sessionId: session.id, expiresAt };
}

export async function rotateRefresh(refreshToken: string, req?: Request) {
  const hash = hashToken(refreshToken);
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.refreshHash, hash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return null;

  const { roles: rKeys, perms } = await loadUserAuthz(session.userId);
  const { token: newToken, hash: newHash } = newRefreshToken();
  await db
    .update(sessions)
    .set({ refreshHash: newHash, ip: req?.ip ?? null, userAgent: req?.get('user-agent') ?? null })
    .where(eq(sessions.id, session.id));

  const accessToken = signAccessToken({
    sub: session.userId,
    tid: user.tenantId,
    roles: rKeys,
    perms,
    mfa: session.mfaSatisfied,
    sid: session.id,
  });
  return { accessToken, refreshToken: newToken, user };
}

export async function revokeByRefresh(refreshToken: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.refreshHash, hashToken(refreshToken)), isNull(sessions.revokedAt)));
}

// small helper used by counts elsewhere
export const countExpr = sql<number>`count(*)`;
