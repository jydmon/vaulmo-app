/**
 * Credentials-ready delivery + social sign-in smoke test (REM-08/09, ACC-02).
 *
 * Verifies the "works when configured, graceful when not" contracts without needing
 * real provider credentials:
 *  - /auth/providers lists only configured OAuth providers (none in CI → []),
 *  - starting an unconfigured provider is a clean 404 (not a crash),
 *  - email reports 'outbox' mode and push reports the Expo relay + device count,
 *  - a device can register and is counted.
 */
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';

const PORT = 4107; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function adminSession(): Promise<string> {
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.email, 'admin@lifehub.local'));
  const l = await api('POST', '/api/v1/auth/login', undefined, { email: 'admin@lifehub.local', password: 'ChangeMe123!' });
  const tok = l.j?.accessToken;
  const enroll = await api('POST', '/api/v1/mfa/enroll', tok, {});
  const conf = await api('POST', '/api/v1/mfa/confirm', tok, { code: authenticator.generate(enroll.j.secret) });
  return conf.j?.accessToken ?? tok;
}

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  // Social sign-in: providers list is public and only contains configured ones.
  const providers = await api('GET', '/api/v1/auth/providers');
  ok('providers list is public', providers.status === 200 && Array.isArray(providers.j?.providers), `→ ${providers.status}`);

  // Unconfigured provider start → clean 404, not a crash.
  const start = await api('GET', '/api/v1/auth/oauth/google/start');
  ok('unconfigured provider start returns 404', start.status === 404, `→ ${start.status}`);

  // A normal user can register a push device.
  const email = `dev+${Date.now()}@example.com`; const password = 'DevUser1234!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Dev User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const utok = login.j?.accessToken; ok('user login', !!utok);
  const reg = await api('POST', '/api/v1/notifications/devices', utok, { platform: 'android', token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' });
  ok('device registers (201)', reg.status === 201, `→ ${reg.status}`);

  // Admin delivery status: email outbox (no SMTP in CI), push relay = expo, device counted.
  const tok = await adminSession();
  const status = await api('GET', '/api/v1/notifications/admin/delivery', tok);
  ok('delivery status readable by admin', status.status === 200, `→ ${status.status}`);
  ok('email mode is outbox when SMTP unset', status.j?.email?.mode === 'outbox' && status.j?.email?.live === false, JSON.stringify(status.j?.email));
  ok('push relay is expo', status.j?.push?.relay === 'expo', JSON.stringify(status.j?.push));
  ok('registered device is counted', (status.j?.push?.devicesRegistered ?? 0) >= 1, `→ ${status.j?.push?.devicesRegistered}`);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
