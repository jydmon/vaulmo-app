import { Router, urlencoded } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, tenants, roles, userRoles, authTokens, sessions } from '../../db/schema';
import { env } from '../../env';
import { hashPassword, verifyPassword, passwordMeetsPolicy } from '../../lib/password';
import { type OAuthProvider, providerConfigured, configuredProviders, authorizeUrl, exchangeCode, type OAuthProfile } from '../../lib/oauth';
import { verifyTotp, hashRecoveryCode } from '../../lib/totp';
import { decryptMaybe } from '../../lib/crypto';
import { signAccessToken, newRefreshToken, hashToken } from '../../lib/jwt';
import { audit } from '../../lib/audit';
import { sendEmail } from '../../lib/notify';
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

  // Mandatory email verification (when enabled) — staff/super-admin accounts and
  // already-verified users pass; everyone else must verify first.
  if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    const { roles: rKeys0 } = await loadUserAuthz(user.id);
    if (!rKeys0.includes('super_admin')) {
      await audit({ action: 'auth.login', actorId: user.id, outcome: 'failure', metadata: { reason: 'email_not_verified' }, req });
      throw new AppError(403, 'email_not_verified', 'Please verify your email address before signing in.');
    }
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

// Branded transactional-email templates (sent as HTML; the mailer auto-detects HTML).
function emailShell(title: string, intro: string, ctaLabel: string, ctaUrl: string, footer: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px">
    <div style="background:linear-gradient(135deg,#3B82F6,#1E3A8A);border-radius:16px;padding:22px 24px;color:#fff">
      <div style="font-size:20px;font-weight:800;letter-spacing:-.5px">Vaulmo</div>
    </div>
    <div style="border:1px solid #e6ebf3;border-top:0;border-radius:0 0 16px 16px;padding:26px 24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 10px">${title}</h1>
      <p style="font-size:15px;line-height:1.55;color:#334155;margin:0 0 20px">${intro}</p>
      <a href="${ctaUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:12px">${ctaLabel}</a>
      <p style="font-size:12.5px;line-height:1.5;color:#5b6b85;margin:22px 0 0">${footer}</p>
      <p style="font-size:12px;color:#94a3b8;margin:14px 0 0;word-break:break-all">If the button doesn’t work, copy this link into your browser:<br>${ctaUrl}</p>
    </div>
  </div>`;
}

// Request an email-verification link (authenticated). Sends a branded email with a link
// that verifies server-side and returns the user to the app.
authRouter.post('/request-verification', requireAuth, async (req, res) => {
  const token = await issueAuthToken(req.auth!.sub, 'email_verify', 60 * 24);
  const [u] = await db.select({ email: users.email, name: users.fullName }).from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  if (u) {
    const link = `${env.APP_BASE_URL}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
    await sendEmail(u.email, 'Verify your Vaulmo email', emailShell(
      `Confirm your email, ${(u.name || '').split(' ')[0] || 'there'}`,
      'Tap the button below to confirm your email address and finish setting up your Vaulmo account. This link is valid for 24 hours.',
      'Verify my email', link,
      'If you didn’t create a Vaulmo account, you can safely ignore this email.'));
  }
  await audit({ action: 'auth.verify.requested', actorId: req.auth!.sub, req });
  res.json({ sent: true, ...(isDev ? { devToken: token } : {}) });
});

// Verify via the emailed link (GET so it works from any mail client), then redirect
// back to the app. Also keep the POST form for the in-app dev flow.
authRouter.get('/verify-email', async (req, res) => {
  const token = String((req.query as any).token ?? '');
  const userId = token ? await consumeAuthToken(token, 'email_verify') : null;
  if (userId) {
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
    await audit({ action: 'auth.verify.success', actorId: userId, req });
  }
  res.redirect(`${env.APP_BASE_URL}/?verified=${userId ? '1' : '0'}`);
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
    const link = `${env.APP_BASE_URL}/?reset=${encodeURIComponent(devToken)}`;
    await sendEmail(user.email, 'Reset your Vaulmo password', emailShell(
      'Reset your password',
      'We received a request to reset your Vaulmo password. Tap below to choose a new one. This link expires in 30 minutes.',
      'Reset my password', link,
      'If you didn’t request this, you can safely ignore this email — your password won’t change.'));
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

// ---- Social sign-in (ACC-02): Google / Microsoft / Apple OAuth ----
// Which providers the login screen should offer (only the configured ones).
authRouter.get('/providers', (_req, res) => res.json({ providers: configuredProviders() }));

// Find-or-create the user for a verified social profile, mirroring registration
// (own household + owner role). OAuth accounts get an unusable random password hash —
// they sign in via the provider (or "forgot password" to set one).
async function upsertOAuthUser(profile: OAuthProfile) {
  const [existing] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
  if (existing) {
    if (!existing.emailVerified && profile.emailVerified) await db.update(users).set({ emailVerified: true }).where(eq(users.id, existing.id));
    return existing;
  }
  const [ownerRole] = await db.select().from(roles).where(eq(roles.key, ROLES.TENANT_OWNER)).limit(1);
  if (!ownerRole) throw new AppError(500, 'not_seeded', 'Roles are not seeded');
  const passwordHash = await hashPassword(`oauth-${crypto.randomUUID()}-${Date.now()}`);
  return db.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: `${(profile.name || profile.email).split(' ')[0]}'s Household`, type: 'HOUSEHOLD', status: 'TRIALING', plan: 'starter' }).returning();
    const [created] = await tx.insert(users).values({ email: profile.email, passwordHash, fullName: profile.name || profile.email.split('@')[0], tenantId: tenant.id, status: 'ACTIVE', emailVerified: profile.emailVerified }).returning();
    await tx.insert(userRoles).values({ userId: created.id, roleId: ownerRole.id });
    return created;
  });
}

async function handleOAuthCallback(provider: OAuthProvider, code: string, state: string, req: any, res: any) {
  try {
    const d = jwt.verify(state, env.JWT_ACCESS_SECRET) as any;
    if (d.purpose !== 'oauth_state' || d.p !== provider) throw new Error('mismatch');
  } catch {
    throw new AppError(400, 'bad_state', 'Sign-in link expired or invalid — please try again.');
  }
  let profile: OAuthProfile;
  try { profile = await exchangeCode(provider, code); }
  catch (e) { throw new AppError(400, 'oauth_failed', (e as Error).message); }

  const user = await upsertOAuthUser(profile);
  if (user.status === 'SUSPENDED' || user.status === 'DISABLED') throw new AppError(403, 'account_disabled', 'This account is not active');
  const { roles: rKeys, perms } = await loadUserAuthz(user.id);
  const tokens = await issueSession({ userId: user.id, tenantId: user.tenantId, roles: rKeys, perms, mfaSatisfied: !user.mfaEnabled, req, refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ action: 'auth.oauth.login', actorId: user.id, tenantId: user.tenantId, metadata: { provider }, req });
  // Hand the tokens to the SPA via the URL fragment (never logged/sent to servers).
  const payload = Buffer.from(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })).toString('base64url');
  res.redirect(`${env.APP_BASE_URL}/#oauth=${payload}`);
}

const isProvider = (p: string): p is OAuthProvider => p === 'google' || p === 'microsoft' || p === 'apple';

// Step 1: the SPA asks for the provider's authorize URL and redirects the browser to it.
authRouter.get('/oauth/:provider/start', authLimiter, (req, res) => {
  const p = req.params.provider;
  if (!isProvider(p) || !providerConfigured(p)) throw new AppError(404, 'provider_unavailable', 'That sign-in method is not enabled');
  const state = jwt.sign({ purpose: 'oauth_state', p, n: crypto.randomUUID() }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' });
  res.json({ url: authorizeUrl(p, state) });
});

// Step 2: the provider redirects back here (Google/Microsoft via GET, Apple via POST).
authRouter.get('/oauth/:provider/callback', async (req, res) => {
  const p = req.params.provider;
  if (!isProvider(p)) throw new AppError(404, 'provider_unavailable', 'Unknown provider');
  const code = String(req.query.code || ''); const state = String(req.query.state || '');
  if (!code) throw new AppError(400, 'no_code', 'Missing authorization code');
  await handleOAuthCallback(p, code, state, req, res);
});
authRouter.post('/oauth/:provider/callback', urlencoded({ extended: false }), async (req, res) => {
  const p = req.params.provider;
  if (!isProvider(p)) throw new AppError(404, 'provider_unavailable', 'Unknown provider');
  const code = String(req.body?.code || ''); const state = String(req.body?.state || '');
  if (!code) throw new AppError(400, 'no_code', 'Missing authorization code');
  await handleOAuthCallback(p, code, state, req, res);
});
