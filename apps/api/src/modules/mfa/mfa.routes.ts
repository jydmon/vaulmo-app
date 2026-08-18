import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { env } from '../../env';
import { loadUserAuthz, issueSession } from '../auth/auth.service';
import {
  generateMfaSecret,
  buildOtpAuthUrl,
  otpAuthQrDataUrl,
  verifyTotp,
  generateRecoveryCodes,
} from '../../lib/totp';
import { encrypt, decryptMaybe } from '../../lib/crypto';

export const mfaRouter = Router();
mfaRouter.use(requireAuth);

async function me(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new AppError(404, 'not_found', 'User not found');
  return u;
}

// Step 1: begin enrolment — generate a secret + QR. Not yet active.
mfaRouter.post('/enroll', async (req, res) => {
  const user = await me(req.auth!.sub);
  if (user.mfaEnabled) throw new AppError(400, 'mfa_already_enabled', 'MFA is already enabled');
  const secret = generateMfaSecret();
  // Store the TOTP secret ENCRYPTED at rest (AES-256-GCM).
  await db.update(users).set({ mfaSecret: encrypt(secret) }).where(eq(users.id, user.id));
  const otpauth = buildOtpAuthUrl(user.email, secret);
  const qr = await otpAuthQrDataUrl(otpauth);
  await audit({ action: 'mfa.enroll.begin', actorId: user.id, tenantId: user.tenantId, req });
  res.json({ secret, otpauthUrl: otpauth, qrDataUrl: qr });
});

// Step 2: confirm enrolment with a valid code → activates MFA, returns recovery codes once.
const confirmSchema = z.object({ code: z.string().min(6).max(10) });
mfaRouter.post('/confirm', async (req, res) => {
  const { code } = confirmSchema.parse(req.body);
  const user = await me(req.auth!.sub);
  if (!user.mfaSecret) throw new AppError(400, 'mfa_not_started', 'Begin enrolment first');
  if (!verifyTotp(code, decryptMaybe(user.mfaSecret) ?? "")) throw new AppError(401, 'invalid_mfa', 'Code did not match');

  const { plain, hashed } = generateRecoveryCodes();
  await db.update(users).set({ mfaEnabled: true, mfaRecoveryCodes: hashed }).where(eq(users.id, user.id));
  await audit({ action: 'mfa.enabled', actorId: user.id, tenantId: user.tenantId, req });
  // The user just proved possession of the TOTP secret, so upgrade the session to
  // MFA-satisfied — this lets a newly-enrolled admin continue without a second sign-in.
  const { roles: rKeys, perms } = await loadUserAuthz(user.id);
  const tokens = await issueSession({ userId: user.id, tenantId: user.tenantId, roles: rKeys, perms, mfaSatisfied: true, req, refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS });
  res.json({ enabled: true, recoveryCodes: plain, user: { id: user.id, email: user.email, fullName: user.fullName, tenantId: user.tenantId, mfaEnabled: true, status: user.status }, ...tokens });
});

mfaRouter.post('/disable', async (req, res) => {
  const { code } = confirmSchema.parse(req.body);
  const user = await me(req.auth!.sub);
  if (!user.mfaEnabled || !user.mfaSecret) throw new AppError(400, 'mfa_not_enabled', 'MFA not enabled');
  if (!verifyTotp(code, decryptMaybe(user.mfaSecret) ?? "")) throw new AppError(401, 'invalid_mfa', 'Code did not match');
  await db
    .update(users)
    .set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] })
    .where(eq(users.id, user.id));
  await audit({ action: 'mfa.disabled', actorId: user.id, tenantId: user.tenantId, req });
  res.json({ enabled: false });
});
