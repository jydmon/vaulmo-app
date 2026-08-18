/**
 * Extra features proof: MFA-secret encryption at rest, email verification,
 * password reset (with session revocation), manual trip/purchase creation,
 * Open Banking recurring-payment detection (mock-first, confirm-before-live),
 * and device/session management (list + revoke + sign-out-others).
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';
import { isEncrypted } from '../src/lib/crypto';
import { authenticator } from 'otplib';

const PORT = 4017;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d && '— ' + d}`)); };
async function api(method: string, url: string, o: { body?: unknown; token?: string } = {}) {
  const h: Record<string, string> = {}; if (o.token) h.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: res.status, json: j };
}
const login = (e: string, p: string) => api('POST', '/api/v1/auth/login', { body: { email: e, password: p } });

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  const email = `x+${Date.now()}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'Password123!', fullName: 'Ada Lovelace' } });
  const userId = reg.json.user.id;
  const token = reg.json.accessToken;

  console.log('\nMFA SECRET ENCRYPTED AT REST');
  const enroll = await api('POST', '/api/v1/mfa/enroll', { token });
  const secret = enroll.json.secret;
  await api('POST', '/api/v1/mfa/confirm', { token, body: { code: authenticator.generate(secret) } });
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  check('stored MFA secret is ciphertext, not the raw base32 secret', !!row.mfaSecret && row.mfaSecret !== secret && isEncrypted(row.mfaSecret!));
  const l1 = await login(email, 'Password123!');
  check('login now requires MFA', l1.json.mfaRequired === true);
  const l2 = await api('POST', '/api/v1/auth/login/mfa', { token: l1.json.challengeToken, body: { code: authenticator.generate(secret) } });
  check('MFA login still works with the encrypted secret', !!l2.json.accessToken);

  console.log('\nEMAIL VERIFICATION');
  const mfaTok = l2.json.accessToken;
  const reqV = await api('POST', '/api/v1/auth/request-verification', { token: mfaTok });
  check('verification token issued (dev)', !!reqV.json.devToken);
  const ver = await api('POST', '/api/v1/auth/verify-email', { body: { token: reqV.json.devToken } });
  check('email is verified via the token', ver.json.verified === true);
  const [row2] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  check('emailVerified flag is set in the DB', row2.emailVerified === true);
  const badVer = await api('POST', '/api/v1/auth/verify-email', { body: { token: 'nope-nope-nope' } });
  check('an invalid verification token is rejected', badVer.status === 400);

  console.log('\nPASSWORD RESET (+ session revocation)');
  // fresh user without MFA for a clean reset test
  const email2 = `y+${Date.now()}@lifehub.local`;
  const reg2 = await api('POST', '/api/v1/auth/register', { body: { email: email2, password: 'OldPass123!', fullName: 'Grace Hopper' } });
  const oldRefresh = reg2.json.refreshToken;
  const rr = await api('POST', '/api/v1/auth/request-password-reset', { body: { email: email2 } });
  check('reset token issued (dev)', !!rr.json.devToken);
  const reset = await api('POST', '/api/v1/auth/reset-password', { body: { token: rr.json.devToken, newPassword: 'BrandNew123!' } });
  check('password is reset', reset.json.reset === true);
  check('old password no longer works', (await login(email2, 'OldPass123!')).status === 401);
  check('new password works', !!(await login(email2, 'BrandNew123!')).json.accessToken);
  const oldRefreshTry = await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: oldRefresh } });
  check('sessions were revoked (old refresh token invalid)', oldRefreshTry.status === 401);
  check('unknown email still returns 200 (no user enumeration)', (await api('POST', '/api/v1/auth/request-password-reset', { body: { email: 'nobody@example.com' } })).status === 200);

  console.log('\nMANUAL TRIP + PURCHASE');
  await db.update(users).set({ isInternalTester: true }).where(eq(users.id, reg2.json.user.id));
  const tok2 = (await login(email2, 'BrandNew123!')).json.accessToken;
  const trip = await api('POST', '/api/v1/trips', { token: tok2, body: { title: 'Paris weekend', destination: 'Paris', startDate: '2026-10-10', endDate: '2026-10-12' } });
  check('a trip can be created manually', trip.status === 201);
  check('the trip appears in the list', (await api('GET', '/api/v1/trips', { token: tok2 })).json.trips.some((t: any) => t.title === 'Paris weekend'));
  const pur = await api('POST', '/api/v1/purchases', { token: tok2, body: { item: 'Dishwasher', merchant: 'Currys', amount: '£399', warrantyExpiry: '2028-12-01' } });
  check('a purchase with a warranty can be created', pur.json.purchase?.isAsset === true);
  const rem = await api('GET', '/api/v1/vault/reminders', { token: tok2 });
  check('the warranty created a live reminder', (rem.json.live ?? []).some((r: any) => /warranty/i.test(r.title)));

  console.log('\nOPEN BANKING — recurring-payment detection (mock-first)');
  const bankConn = await api('POST', '/api/v1/integrations/bank/connect', { token: tok2 });
  check('bank consent (sandbox) starts', typeof bankConn.json.authUrl === 'string' && bankConn.json.authUrl.includes('sandbox'));
  const bankCb = await api('POST', '/api/v1/integrations/bank/callback', { token: tok2, body: { code: 'demo_ob01' } });
  check('bank connection is created', bankCb.status === 201 && bankCb.json.connection?.provider === 'openbanking');
  // Nothing should be live before the user confirms.
  const subsBefore = await api('GET', '/api/v1/tracked-subscriptions', { token: tok2 });
  check('no tracked subscriptions exist before confirmation', (subsBefore.json.subscriptions ?? []).length === 0);
  const bankSync = await api('POST', `/api/v1/integrations/connections/${bankCb.json.connection.id}/sync`, { token: tok2 });
  check('sync detects recurring subscriptions (Netflix/Spotify/PureGym/Prime)', bankSync.json.created >= 3, `created=${bankSync.json.created}`);
  const detected = await api('GET', '/api/v1/integrations/detected?status=pending', { token: tok2 });
  const bankItems = (detected.json.detected ?? []).filter((d: any) => d.source === 'bank');
  check('detected items are PENDING (not yet live)', bankItems.length >= 3 && bankItems.every((d: any) => d.status === 'pending'));
  const netflix = bankItems.find((d: any) => /netflix/i.test(d.rawFrom));
  check('Netflix detected as a monthly subscription with a confidence', !!netflix && netflix.extracted?.cycle === 'monthly' && typeof netflix.extracted?.confidence === 'number');
  check('variable/one-off spend (Tesco, Pret, salary) is NOT flagged', !bankItems.some((d: any) => /tesco|pret|acme/i.test(d.rawFrom)));
  const conf = await api('POST', `/api/v1/inbox/detected/${netflix.id}/confirm`, { token: tok2 });
  check('confirming a detected subscription creates it', conf.json.entityType === 'subscription');
  const subsAfter = await api('GET', '/api/v1/tracked-subscriptions', { token: tok2 });
  const nfSub = (subsAfter.json.subscriptions ?? []).find((s: any) => /netflix/i.test(s.name));
  check('the confirmed subscription is stored with source=bank', !!nfSub && nfSub.source === 'bank');
  const remB = await api('GET', '/api/v1/vault/reminders', { token: tok2 });
  check('a renewal reminder goes live only after confirmation', (remB.json.live ?? []).some((r: any) => /netflix renews/i.test(r.title)));

  console.log('\nDEVICE / SESSION MANAGEMENT');
  const email3 = `z+${Date.now()}@lifehub.local`;
  await api('POST', '/api/v1/auth/register', { body: { email: email3, password: 'DeviceP123!', fullName: 'Device User' } });
  const sA = await login(email3, 'DeviceP123!'); const refreshA = sA.json.refreshToken;
  await login(email3, 'DeviceP123!'); // session B
  const sC = await login(email3, 'DeviceP123!'); const tokenC = sC.json.accessToken; const refreshC = sC.json.refreshToken;
  const list1 = await api('GET', '/api/v1/auth/sessions', { token: tokenC });
  check('all active sessions are listed', (list1.json.sessions ?? []).length >= 3);
  check('exactly one session is flagged as the current device', (list1.json.sessions ?? []).filter((s: any) => s.current).length === 1);
  const nonCurrent = (list1.json.sessions ?? []).find((s: any) => !s.current);
  const rev1 = await api('POST', `/api/v1/auth/sessions/${nonCurrent.id}/revoke`, { token: tokenC });
  check('a single device can be signed out', rev1.json.revoked === true);
  const list2 = await api('GET', '/api/v1/auth/sessions', { token: tokenC });
  check('the revoked session disappears from the list', !(list2.json.sessions ?? []).some((s: any) => s.id === nonCurrent.id));
  const revOthers = await api('POST', '/api/v1/auth/sessions/revoke-others', { token: tokenC });
  check('sign-out-others revokes the remaining sessions', revOthers.json.revoked >= 1);
  const list3 = await api('GET', '/api/v1/auth/sessions', { token: tokenC });
  check('only the current session remains', (list3.json.sessions ?? []).length === 1 && list3.json.sessions[0].current === true);
  check('a revoked session can no longer refresh', (await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: refreshA } })).status === 401);
  check('the current session can still refresh', (await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: refreshC } })).status === 200);

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}\n  RESULT: ${passed} passed, ${failed} failed\n${'='.repeat(48)}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
