/**
 * CRM email campaigns + automations smoke test (admin).
 */
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';
const PORT = 4101; const base = `http://127.0.0.1:${PORT}`;
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
  let tok = l.j?.accessToken;
  const enroll = await api('POST', '/api/v1/mfa/enroll', tok, {});
  const conf = await api('POST', '/api/v1/mfa/confirm', tok, { code: authenticator.generate(enroll.j.secret) });
  return conf.j?.accessToken ?? tok;
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  // Seed a couple of prospect + subscriber tenants so the audience is non-empty.
  const p1 = `prospect+${Date.now()}@example.com`;
  await api('POST', '/api/v1/auth/register', undefined, { email: p1, password: 'Prospect123!', fullName: 'Pat Prospect' });

  const tok = await adminSession();
  ok('admin session obtained', !!tok);

  // Automations seed on first read.
  const autos = await api('GET', '/api/v1/admin/automations', tok);
  ok('automations seeded with defaults', (autos.j?.automations ?? []).length >= 4 && autos.j.automations.some((a: any) => a.key === 'welcome'));
  const toggle = await api('PUT', '/api/v1/admin/automations/inactivity', tok, { enabled: true });
  ok('automation can be toggled on', toggle.j?.automation?.enabled === true);

  // Create a campaign to prospects.
  const create = await api('POST', '/api/v1/admin/campaigns', tok, { name: 'August newsletter', subject: 'What’s new in Vaulmo', body: 'Hello from Vaulmo!', segment: 'prospects' });
  const id = create.j?.campaign?.id; ok('campaign created (draft)', !!id && create.j.campaign.status === 'draft');

  // Audience preview.
  const aud = await api('POST', `/api/v1/admin/campaigns/${id}/audience`, tok, {});
  ok('audience preview returns a count', typeof aud.j?.count === 'number' && aud.j.count >= 1, JSON.stringify(aud.j).slice(0, 80));

  // Send.
  const send = await api('POST', `/api/v1/admin/campaigns/${id}/send`, tok, {});
  ok('campaign sends to the audience', send.j?.sent >= 1 && send.j?.campaign?.status === 'sent', JSON.stringify(send.j).slice(0, 100));

  // Re-send is blocked.
  const resend = await api('POST', `/api/v1/admin/campaigns/${id}/send`, tok, {});
  ok('already-sent campaign cannot be re-sent (409)', resend.status === 409);

  // Detail shows recipients.
  const detail = await api('GET', `/api/v1/admin/campaigns/${id}`, tok);
  ok('campaign detail lists recipients', (detail.j?.recipients ?? []).length >= 1);

  // List includes it.
  const list = await api('GET', '/api/v1/admin/campaigns', tok);
  ok('campaign appears in the list', (list.j?.campaigns ?? []).some((c: any) => c.id === id));

  // A regular user cannot access campaigns.
  const reg = await api('POST', '/api/v1/auth/register', undefined, { email: `u+${Date.now()}@example.com`, password: 'RegUser1234!', fullName: 'Reg User' });
  const denied = await api('GET', '/api/v1/admin/campaigns', reg.j?.accessToken);
  ok('non-admin is denied (403)', denied.status === 403, `→ ${denied.status}`);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
