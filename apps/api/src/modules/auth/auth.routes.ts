import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, tenants, roles, userRoles, authTokens, sessions } from '../../db/schema';
import { env } from '../../env';
import { hashPassword, verifyPassword, passwordMeetsPolicy } from '../../lib/password';
import { verifyTotp, hashRecoveryCode } from '../../lib/totp';
import { decryptMaybe } from '../../lib/crypto';
import { signAccessToken, newRefreshToken, hashToken } from '../../lib/jwt';
import { audit } from '../../lib/audit';
import { ROLES } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { loadUserAuthz, issueSession, rotateRefresh, revokeByRefresh } from './auth.service';

export const authRouter = Router();

const MAX_FAILED = 5;
// Roles for which two-factor authentication is MANDATORY. A privileged admin who has
// not yet enrolled MFA is issued a limited session (mfa:false) that can reach only the
// MFA-enrolment endpoints — every admin route stays blocked by requireMfaSatisfied.
const MFA_REQUIRED_ROLES = ['super_admin', 'security_reviewer', 'support_agent'];
const requiresMfa = (roleKeys: string[]) => roleKeys.some((r) => MFA_REQUIRED_ROLES.includes(r));
const LOCK_MINUTES = 15;

type UserRow = typeof users.$inferSelect;

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    tenantId: u.tenantId,
    mfaEnabled: u.mfaEnabled,
    status: u.status,
  };
}

async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return u;
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  fullName: z.string().min(1).max(120),
  householdName: z.string().min(1).max(120).optional(),
});

// Self-service registration → creates a tenant (household) + its owner user.
authRouter.post('/register', authLimiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  if (!passwordMeetsPolicy(body.password)) {
    throw new AppError(422, 'weak_password', 'Password must be 10+ chars with letters and numbers');
  }
  if (await getUserByEmail(body.email)) {
    throw new AppError(409, 'email_taken', 'An account with that email already exists');
  }

  const [ownerRole] = await db.select().from(roles).where(eq(roles.key, ROLES.TENANT_OWNER)).limit(1);
  if (!ownerRole) throw new AppError(500, 'not_seeded', 'Roles are not seeded');
  const passwordHash = await hashPassword(body.password);

  const user = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: body.householdName ?? `${body.fullName.split(' ')[0]}'s Household`,
        type: 'HOUSEHOLD',
        status: 'TRIALING',
        plan: 'starter',
      })
      .returning();
    const [created] = await tx
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        passwordHash,
        fullName: body.fullName,
        tenantId: tenant.id,
        status: 'ACTIVE',
      })
      .returning();
    await tx.insert(userRoles).values({ userId: created.id, roleId: ownerRole.id });
    return created;
  });

  const { roles: rKeys, perms } = await loadUserAuthz(user.id);
  const tokens = await issueSession({
    userId: user.id,
    tenantId: user.tenantId,
    roles: rKeys,
    perms,
    mfaSatisfied: true,
    req,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  await audit({ action: 'auth.register', actorId: user.id, tenantId: user.tenantId, req });
  res.status(201).json({ user: publicUser(user), ...tokens });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await getUserByEmail(body.email);

  if (!user) {
    await audit({ action: 'auth.login', outcome: 'failure', metadata: { reason: 'no_user' }, req });
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(423, 'account_locked', 'Account temporarily locked. Try again later.');
  }
  if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
    throw new AppError(403, 'account_disabled', 'This account is not active');
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
      })
      .where(eq(users.id, user.id));
    await audit({ action: 'auth.login', actorId: user.id, outcome: 'failure', metadata: { reason: 'bad_password' }, req });
    throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  const { roles: rKeys, perms } = await loadUserAuthz(user.id);

  if (user.mfaEnabled) {
    const challenge = signAccessToken({ sub: user.id, tid: user.tenantId, roles: rKeys, perms, mfa: false });
    await audit({ action: 'auth.login.mfa_challenge', actorId: user.id, tenantId: user.tenantId, req });
    res.json({ mfaRequired: true, challengeToken: challenge });
    return;
  }

  // Administrators MUST have MFA. If a privileged admin has not enrolled yet, hand back a
  // restricted session and flag setup — the client forces enrolment before any admin access.
  if (requiresMfa(rKeys)) {
    const tokens = await issueSession({
      userId: user.id, tenantId: user.tenantId, roles: rKeys, perms,
      mfaSatisfied: false, req, refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    });
    await audit({ action: 'auth.login.mfa_setup_required', actorId: user.id, tenantId: user.tenantId, req });
    res.json({ user: publicUser(user), ...tokens, mfaSetupRequired: true });
    return;
  }

  const tokens = await issueSession({
    userId: user.id,
    tenantId: user.tenantId,
    roles: rKeys,
    perms,
    mfaSatisfied: true,
    req,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  await audit({ action: 'auth.login.success', actorId: user.id, tenantId: user.tenantId, req });
  res.json({ user: publicUser(user), ...tokens });
});

// Completes an MFA-gated login using the challenge token + a TOTP or recovery code.
const mfaLoginSchema = z.object({ code: z.string().min(6).max(20) });
authRouter.post('/login/mfa', authLimiter, requireAuth, async (req, res) => {
  const { code } = mfaLoginSchema.parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (!user) throw new AppError(404, 'not_found', 'User not found');
  if (!user.mfaEnabled || !user.mfaSecret) throw new AppError(400, 'mfa_not_enabled', 'MFA is not enabled');

  let valid = verifyTotp(code, decryptMaybe(user.mfaSecret) ?? "");
  if (!valid) {
    const h = hashRecoveryCode(code);
    if (user.mfaRecoveryCodes.includes(h)) {
      valid = true;
      await db
        .update(users)
        .set({ mfaRecoveryCodes: user.mfaRecoveryCodes.filter((c) => c !== h) })
        .where(eq(users.id, user.id));
    }
  }
  if (!valid) {
    await audit({ action: 'auth.mfa.verify', actorId: user.id, outcome: 'failure', req });
    throw new AppError(401, 'invalid_mfa', 'Invalid authentication code');
  }

  const { roles: rKeys, perms } = await loadUserAuthz(user.id);
  const tokens = await issueSession({
    userId: user.id,
    tenantId: user.tenantId,
    roles: rKeys,
    perms,
    mfaSatisfied: true,
    req,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  });
  await audit({ action: 'auth.login.success', actorId: user.id, tenantId: user.tenantId, metadata: { mfa: true }, req });
  res.json({ user: publicUser(user), ...tokens });
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });
authRouter.post('/refresh', async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await rotateRefresh(refreshToken, req);
  if (!result) throw new AppError(401, 'invalid_refresh', 'Invalid or expired refresh token');
  res.json({ accessToken: result.accessToken, refreshToken: result.refreshToken });
});

authRouter.post('/logout', async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  await revokeByRefresh(refreshToken);
  res.json({ ok: true });
});

/* ---------- Email verification + password reset ---------- */
const isDev = env.APP_ENV === 'development';
async function issueAuthToken(userId: string, kind: 'email_verify' | 'password_reset', ttlMin: number) {
  const { token, hash } = newRefreshToken();
  await db.insert(authTokens).values({ userId, kind, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMin * 60000) });
  return token; // emailed in production; returned only in dev
}
async function consumeAuthToken(token: string, kind: string) {
  const [row] = await db.select().from(authTokens).where(eq(authTokens.tokenHash, hashToken(token))).limit(1);
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) return null;
  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row.userId;
}

// Request an email-verification link (authenticated).
authRouter.post('/request-verification', requireAuth, async (req, res) => {
  const token = await issueAuthToken(req.auth!.sub, 'email_verify', 60 * 24);
  await audit({ action: 'auth.verify.requested', actorId: req.auth!.sub, req });
  res.json({ sent: true, ...(isDev ? { devToken: token } : {}) });
});

const tokenSchema = z.object({ token: z.string().min(10) });
authRouter.post('/verify-email', async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const userId = await consumeAuthToken(token, 'email_verify');
  if (!userId) throw new AppError(400, 'invalid_token', 'Invalid or expired verification link');
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
  await audit({ action: 'auth.verify.success', actorId: userId, req });
  res.json({ verified: true });
});

// Request a password reset — always returns 200 (never reveals whether the email exists).
authRouter.post('/request-password-reset', authLimiter, async (req, res) => {
  const email = z.object({ email: z.string().email() }).parse(req.body).email.toLowerCase();
  const user = await getUserByEmail(email);
  let devToken: string | undefined;
  if (user) {
    devToken = await issueAuthToken(user.id, 'password_reset', 30);
    await audit({ action: 'auth.reset.requested', actorId: user.id, req });
  }
  res.json({ sent: true, ...(isDev && devToken ? { devToken } : {}) });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const { token, newPassword } = z.object({ token: z.string().min(10), newPassword: z.string().min(10) }).parse(req.body);
  if (!passwordMeetsPolicy(newPassword)) throw new AppError(422, 'weak_password', 'Password must be 10+ chars with letters and numbers');
  const userId = await consumeAuthToken(token, 'password_reset');
  if (!userId) throw new AppError(400, 'invalid_token', 'Invalid or expired reset link');
  await db.update(users).set({ passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
  // Revoke all existing sessions after a password reset.
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
  await audit({ action: 'auth.reset.success', actorId: userId, req });
  res.json({ reset: true });
});

// ---- Device / session management (list + revoke) ----
// Users can see every device with an active session and sign any of them out.
// The session backing the current request is flagged so the UI can label "This device".
authRouter.get('/sessions', requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, req.auth!.sub), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.createdAt));
  res.json({
    sessions: rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      mfaSatisfied: s.mfaSatisfied,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.id === req.auth!.sid,
    })),
  });
});

// Revoke one session (sign out that device). Only the owner can revoke their own.
authRouter.post('/sessions/:id/revoke', requireAuth, async (req, res) => {
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, req.params.id), eq(sessions.userId, req.auth!.sub), isNull(sessions.revokedAt)))
    .returning();
  if (!row) throw new AppError(404, 'not_found', 'Session not found');
  await audit({ action: 'auth.session.revoked', actorId: req.auth!.sub, targetType: 'session', targetId: row.id, metadata: { self: row.id === req.auth!.sid }, req });
  res.json({ revoked: true });
});

// Sign out everywhere else — keeps the current session, revokes all others.
authRouter.post('/sessions/revoke-others', requireAuth, async (req, res) => {
  const conds = [eq(sessions.userId, req.auth!.sub), isNull(sessions.revokedAt)];
  if (req.auth!.sid) conds.push(ne(sessions.id, req.auth!.sid));
  const rows = await db.update(sessions).set({ revokedAt: new Date() }).where(and(...conds)).returning();
  await audit({ action: 'auth.session.revoked_others', actorId: req.auth!.sub, metadata: { count: rows.length }, req });
  res.json({ revoked: rows.length });
});
