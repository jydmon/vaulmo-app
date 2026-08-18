/**
 * End-to-end proof of the Phase 1 objective:
 * "users can securely register, authenticate and access the platform".
 *
 * Boots the real API in-process against the real Postgres dev database and
 * exercises: health → register → profile/RBAC → MFA enrol → MFA login →
 * file upload (tenant-scoped) → RBAC denial → Super Admin access → audit trail
 * → refresh rotation → brute-force lockout signal.
 */
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';

const PORT = 4010;
const base = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`);
  }
}

async function api(method: string, path: string, body?: unknown, token?: string, raw?: Buffer) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: string | Buffer | undefined;
  if (raw) {
    headers['content-type'] = 'application/octet-stream';
    payload = raw;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  const email = `sarah+${Date.now()}@reid.family`;
  const password = 'Sup3rSecret!42';

  console.log('\nHEALTH & MONITORING');
  check('GET /livez is ok', (await api('GET', '/livez')).json?.status === 'ok');
  check('GET /readyz reports DB up', (await api('GET', '/readyz')).json?.db === 'up');
  check('GET /metrics exposes gauges', (await api('GET', '/metrics')).json?.toString?.().includes('lifehub_users_total') ?? false);

  console.log('\nREGISTRATION');
  const reg = await api('POST', '/api/v1/auth/register', {
    email,
    password,
    fullName: 'Sarah Reid',
    householdName: 'The Reid Household',
  });
  check('register returns 201', reg.status === 201, `got ${reg.status}`);
  check('register issues access + refresh tokens', !!reg.json?.accessToken && !!reg.json?.refreshToken);
  check('register creates a tenant for the user', !!reg.json?.user?.tenantId);
  const userToken: string = reg.json?.accessToken;
  let refreshToken: string = reg.json?.refreshToken;

  check('duplicate email is rejected (409)', (await api('POST', '/api/v1/auth/register', { email, password, fullName: 'x' })).status === 409);
  check('weak password is rejected (422)', (await api('POST', '/api/v1/auth/register', { email: `w${Date.now()}@x.com`, password: 'short', fullName: 'x' })).status === 422);

  console.log('\nPROFILE & RBAC (role: tenant_owner)');
  const me = await api('GET', '/api/v1/users/me', undefined, userToken);
  check('GET /me returns the profile', me.json?.email === email);
  check('user has tenant_owner role', me.json?.roles?.includes('tenant_owner'));
  check('user has file:write permission', me.json?.permissions?.includes('file:write'));
  check('tenant_owner is DENIED platform admin (403)', (await api('GET', '/api/v1/admin/tenants', undefined, userToken)).status === 403);

  console.log('\nMFA ENROLMENT (TOTP)');
  const enroll = await api('POST', '/api/v1/mfa/enroll', {}, userToken);
  check('enroll returns a secret + QR', !!enroll.json?.secret && !!enroll.json?.qrDataUrl);
  const secret: string = enroll.json?.secret;
  const confirm = await api('POST', '/api/v1/mfa/confirm', { code: authenticator.generate(secret) }, userToken);
  check('confirm enables MFA + returns recovery codes', confirm.json?.enabled === true && Array.isArray(confirm.json?.recoveryCodes));
  const recoveryCode: string = confirm.json?.recoveryCodes?.[0];

  console.log('\nAUTHENTICATION WITH MFA');
  const login1 = await api('POST', '/api/v1/auth/login', { email, password });
  check('login now requires MFA (challenge issued)', login1.json?.mfaRequired === true && !!login1.json?.challengeToken);
  const badMfa = await api('POST', '/api/v1/auth/login/mfa', { code: '000000' }, login1.json?.challengeToken);
  check('wrong MFA code is rejected (401)', badMfa.status === 401);
  const goodMfa = await api('POST', '/api/v1/auth/login/mfa', { code: authenticator.generate(secret) }, login1.json?.challengeToken);
  check('correct MFA completes login', !!goodMfa.json?.accessToken);
  const mfaToken: string = goodMfa.json?.accessToken;
  // recovery code path
  const login2 = await api('POST', '/api/v1/auth/login', { email, password });
  const rec = await api('POST', '/api/v1/auth/login/mfa', { code: recoveryCode }, login2.json?.challengeToken);
  check('a one-time recovery code also completes login', !!rec.json?.accessToken);

  console.log('\nSECURE FILE STORAGE (tenant-scoped)');
  const init = await api('POST', '/api/v1/files/init-upload', { filename: 'passport.pdf', contentType: 'application/pdf', sizeBytes: 11 }, mfaToken);
  check('init-upload returns a presigned URL', init.status === 201 && !!init.json?.uploadUrl);
  const up = await api('PUT', init.json?.uploadUrl, undefined, mfaToken, Buffer.from('PDFCONTENT!'));
  check('upload stores the file + checksum', up.json?.status === 'STORED' && !!up.json?.checksum);
  const list = await api('GET', '/api/v1/files', undefined, mfaToken);
  check('file appears in the tenant vault', Array.isArray(list.json?.files) && list.json.files.length === 1);

  console.log('\nSUPER ADMIN (platform role)');
  const sa1 = await api('POST', '/api/v1/auth/login', { email: 'admin@lifehub.local', password: 'ChangeMe123!' });
  check('super admin can log in', !!sa1.json?.accessToken, `status ${sa1.status}`);
  const saToken: string = sa1.json?.accessToken;
  const tenants = await api('GET', '/api/v1/admin/tenants', undefined, saToken);
  check('super admin CAN read all tenants (200)', tenants.status === 200 && Array.isArray(tenants.json?.tenants));
  check('platform sees the newly registered tenant', tenants.json?.tenants?.some((t: any) => t.name === 'The Reid Household'));
  const metrics = await api('GET', '/api/v1/admin/metrics', undefined, saToken);
  check('super admin metrics report users > 0', Number(metrics.json?.users) > 0);

  console.log('\nAUDIT TRAIL (append-only)');
  const audit = await api('GET', '/api/v1/admin/audit', undefined, saToken);
  const actions: string[] = (audit.json?.logs ?? []).map((l: any) => l.action);
  check('audit captured registration', actions.includes('auth.register'));
  check('audit captured successful login', actions.includes('auth.login.success'));
  check('audit captured MFA enablement', actions.includes('mfa.enabled'));
  check('audit captured file upload', actions.includes('file.upload'));
  check('audit captured the RBAC denial', actions.includes('authz.denied'));

  console.log('\nSESSION LIFECYCLE');
  const refreshed = await api('POST', '/api/v1/auth/refresh', { refreshToken });
  check('refresh token rotates to a new pair', !!refreshed.json?.accessToken && refreshed.json?.refreshToken !== refreshToken);
  const oldReuse = await api('POST', '/api/v1/auth/refresh', { refreshToken });
  check('old refresh token cannot be reused', oldReuse.status === 401);

  console.log('\nBRUTE-FORCE PROTECTION');
  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    lastStatus = (await api('POST', '/api/v1/auth/login', { email, password: 'wrong-password' })).status;
  }
  check('repeated bad passwords lock the account (423)', lastStatus === 423, `last status ${lastStatus}`);

  server.close();
  await pool.end();

  console.log(`\n${'='.repeat(48)}`);
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(48));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
