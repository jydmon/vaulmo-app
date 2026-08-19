import { createApp } from '../src/app';
import { pool } from '../src/db/client';
const PORT = 4033; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));
  const email = `mob+${Date.now()}@example.com`;
  await api('POST', '/api/v1/auth/register', undefined, { email, password: 'Mobile123!', fullName: 'Mob User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password: 'Mobile123!' });
  const tok = login.j?.accessToken; ok('login', !!tok);
  const gets = [
    '/api/v1/trips', '/api/v1/purchases', '/api/v1/tracked-subscriptions',
    '/api/v1/family/members', '/api/v1/family/nok', '/api/v1/emergency/status', '/api/v1/emergency/requests',
    '/api/v1/billing/plans', '/api/v1/billing', '/api/v1/billing/entitlements',
    '/api/v1/support/tickets', '/api/v1/cms/articles',
    '/api/v1/notifications/settings', '/api/v1/auth/sessions', '/api/v1/integrations/providers', '/api/v1/integrations/connections',
  ];
  for (const g of gets) { const r = await api('GET', g, tok); ok(`GET ${g}`, r.status === 200, `→ ${r.status} ${JSON.stringify(r.j).slice(0,80)}`); }
  // a couple of creates
  const ct = await api('POST', '/api/v1/trips', tok, { title: 'Test trip', destination: 'Rome' }); ok('POST /trips', ct.status < 300, `→ ${ct.status}`);
  const cp = await api('POST', '/api/v1/purchases', tok, { item: 'TV', merchant: 'Argos' }); ok('POST /purchases', cp.status < 300, `→ ${cp.status}`);
  const cm = await api('POST', '/api/v1/family/members', tok, { name: 'Kid One', relationship: 'child' }); ok('POST /family/members', cm.status < 300, `→ ${cm.status}`);
  const st = await api('POST', '/api/v1/support/tickets', tok, { subject: 'Help', body: 'Please help' }); ok('POST /support/tickets', st.status < 300, `→ ${st.status}`);
  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
