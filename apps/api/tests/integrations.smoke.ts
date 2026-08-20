/**
 * Integrations scaffolding smoke test.
 * Run with GOOGLE_CLIENT_ID/SECRET set → Gmail is "live": Connected Services opens to
 * all subscribed users and the connect URL is the real Google consent URL.
 * (A second shell run without the creds asserts the gate closes again.)
 */
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
const PORT = 4088; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function main() {
  const live = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));
  const email = `int+${Date.now()}@example.com`; const password = 'Integrations123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Int User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const tok = login.j?.accessToken; ok('login', !!tok);

  const providers = await api('GET', '/api/v1/integrations/providers', tok);
  if (live) {
    ok('LIVE: normal user can access Connected Services', providers.status === 200, `→ ${providers.status}`);
    const gmail = (providers.j?.providers ?? []).find((p: any) => p.key === 'gmail');
    ok('LIVE: gmail marked live', gmail?.live === true, JSON.stringify(gmail));
    const outlook = (providers.j?.providers ?? []).find((p: any) => p.key === 'outlook');
    ok('LIVE: outlook NOT live (no MS creds)', outlook?.live === false);
    const connect = await api('POST', '/api/v1/integrations/gmail/connect', tok, {});
    ok('LIVE: gmail connect returns Google consent URL', typeof connect.j?.authUrl === 'string' && connect.j.authUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), connect.j?.authUrl?.slice(0, 60));
    ok('LIVE: consent URL carries the client_id', (connect.j?.authUrl ?? '').includes(`client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID!)}`));

    // INT-06 pause/resume — use a sandbox Outlook connection (reachable now the gate is open).
    const cb = await api('POST', '/api/v1/integrations/outlook/callback', tok, { code: 'demo123' });
    const connId = cb.j?.connection?.id; ok('sandbox outlook connection created', !!connId, `→ ${cb.status}`);
    const pause = await api('POST', `/api/v1/integrations/connections/${connId}/pause`, tok, {});
    ok('pause sets status=paused', pause.j?.connection?.status === 'paused', JSON.stringify(pause.j));
    const syncPaused = await api('POST', `/api/v1/integrations/connections/${connId}/sync`, tok, {});
    ok('sync is blocked while paused (409)', syncPaused.status === 409, `→ ${syncPaused.status}`);
    const resume = await api('POST', `/api/v1/integrations/connections/${connId}/resume`, tok, {});
    ok('resume sets status=connected', resume.j?.connection?.status === 'connected');
    const syncOk = await api('POST', `/api/v1/integrations/connections/${connId}/sync`, tok, {});
    ok('sync works after resume', syncOk.status === 200, `→ ${syncOk.status}`);
  } else {
    ok('GATED: normal user is blocked (no live provider)', providers.status === 403, `→ ${providers.status}`);
  }

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed  [mode: ${live ? 'live' : 'gated'}]\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
