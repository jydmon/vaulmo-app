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
  const stamp = Date.now();

  // Seed an app user (prospect), a website waitlist sign-up, and a contact-form sender
  // so each audience group resolves to at least one recipient.
  await api('POST', '/api/v1/auth/register', undefined, { email: `prospect+${stamp}@example.com`, password: 'Prospect123!', fullName: 'Pat Prospect' });
  await api('POST', '/api/v1/site/subscribe', undefined, { name: 'Wendy Waitlist', email: `wait+${stamp}@example.com`, notifyAtLaunch: true });
  await api('POST', '/api/v1/site/contact', undefined, { name: 'Connie Contact', email: `contact+${stamp}@example.com`, message: 'Hello there' });

  const tok = await adminSession();
  ok('admin session obtained', !!tok);

  // Audience catalogue is exposed for the UI.
  const meta = await api('GET', '/api/v1/admin/campaigns-meta', tok);
  ok('audience catalogue lists the groups', (meta.j?.audiences ?? []).some((a: any) => a.key === 'waitlist') && meta.j.audiences.some((a: any) => a.key === 'contacts') && meta.j.audiences.some((a: any) => a.key === 'users'));

  // Automations seed on first read.
  const autos = await api('GET', '/api/v1/admin/automations', tok);
  ok('automations seeded with defaults', (autos.j?.automations ?? []).length >= 4 && autos.j.automations.some((a: any) => a.key === 'welcome'));
  const toggle = await api('PUT', '/api/v1/admin/automations/inactivity', tok, { enabled: true });
  ok('automation can be toggled on', toggle.j?.automation?.enabled === true);

  // Validation: at least one audience group is required.
  const noAud = await api('POST', '/api/v1/admin/campaigns', tok, { name: 'x', subject: 's', body: 'b', audiences: [] });
  ok('empty audience rejected (422)', noAud.status === 422, `→ ${noAud.status}`);

  // Ad-hoc audience preview across multiple groups (de-duplicated union).
  const pre = await api('POST', '/api/v1/admin/campaigns/preview/audience', tok, { audiences: ['prospects', 'waitlist', 'contacts'] });
  ok('multi-group audience preview counts recipients', typeof pre.j?.count === 'number' && pre.j.count >= 3, JSON.stringify(pre.j).slice(0, 100));

  // Create a rich-HTML campaign to three groups.
  const html = '<h1 style="color:#2563EB">Hi {{name}}</h1><p>Rich <b>HTML</b> email.</p>';
  const create = await api('POST', '/api/v1/admin/campaigns', tok, { name: 'August newsletter', subject: 'What’s new in Vaulmo', body: html, format: 'html', audiences: ['prospects', 'waitlist', 'contacts'] });
  const id = create.j?.campaign?.id;
  ok('HTML campaign created (draft)', !!id && create.j.campaign.status === 'draft' && create.j.campaign.format === 'html' && (create.j.campaign.audiences ?? []).length === 3);

  // Saved-campaign audience preview.
  const aud = await api('POST', `/api/v1/admin/campaigns/${id}/audience`, tok, {});
  ok('saved-campaign audience preview returns a count', typeof aud.j?.count === 'number' && aud.j.count >= 3, JSON.stringify(aud.j).slice(0, 80));

  // Edit is allowed before sending.
  const edit = await api('PUT', `/api/v1/admin/campaigns/${id}`, tok, { subject: 'Edited subject' });
  ok('draft campaign can be edited', edit.status === 200 && edit.j?.campaign?.subject === 'Edited subject');

  // Send now.
  const send = await api('POST', `/api/v1/admin/campaigns/${id}/send`, tok, {});
  ok('HTML campaign sends to the union', send.j?.sent >= 3 && send.j?.campaign?.status === 'sent', JSON.stringify(send.j).slice(0, 100));
  const resend = await api('POST', `/api/v1/admin/campaigns/${id}/send`, tok, {});
  ok('already-sent campaign cannot be re-sent (409)', resend.status === 409);
  const editSent = await api('PUT', `/api/v1/admin/campaigns/${id}`, tok, { subject: 'no' });
  ok('a sent campaign cannot be edited (409)', editSent.status === 409);

  // Schedule a campaign in the past → it is 'scheduled', then process-due sends it.
  const past = new Date(stamp - 60_000).toISOString();
  const sched = await api('POST', '/api/v1/admin/campaigns', tok, { name: 'Scheduled blast', subject: 'Later', body: 'Scheduled body', format: 'text', audiences: ['waitlist'], scheduledAt: past });
  const sid = sched.j?.campaign?.id;
  ok('campaign can be scheduled', sched.j?.campaign?.status === 'scheduled' && !!sched.j?.campaign?.scheduledAt, JSON.stringify(sched.j?.campaign).slice(0, 80));
  const due = await api('POST', '/api/v1/admin/campaigns/process-due', tok, {});
  ok('due scheduled campaigns are processed', (due.j?.sent ?? 0) >= 1, JSON.stringify(due.j));
  const after = await api('GET', `/api/v1/admin/campaigns/${sid}`, tok);
  ok('scheduled campaign becomes sent after processing', after.j?.campaign?.status === 'sent');

  // Detail shows recipients; list includes it.
  const detail = await api('GET', `/api/v1/admin/campaigns/${id}`, tok);
  ok('campaign detail lists recipients', (detail.j?.recipients ?? []).length >= 1);
  const list = await api('GET', '/api/v1/admin/campaigns', tok);
  ok('campaign appears in the list', (list.j?.campaigns ?? []).some((c: any) => c.id === id));

  // A regular user cannot access campaigns.
  const reg = await api('POST', '/api/v1/auth/register', undefined, { email: `u+${stamp}@example.com`, password: 'RegUser1234!', fullName: 'Reg User' });
  const denied = await api('GET', '/api/v1/admin/campaigns', reg.j?.accessToken);
  ok('non-admin is denied (403)', denied.status === 403, `→ ${denied.status}`);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
