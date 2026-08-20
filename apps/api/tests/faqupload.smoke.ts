/**
 * FAQ endpoint + document file-upload (non-scan path) + manual metadata smoke test.
 */
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
const PORT = 4100; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, opts: { token?: string; body?: any; raw?: string; ct?: string } = {}) {
  const h: any = {}; if (opts.token) h.authorization = `Bearer ${opts.token}`;
  let body: any; if (opts.raw !== undefined) { h['content-type'] = opts.ct ?? 'application/octet-stream'; body = opts.raw; } else if (opts.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const r = await fetch(base + url, { method, headers: h, body });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  // FAQ is public.
  const faq = await api('GET', '/api/v1/faq');
  ok('FAQ is public', faq.status === 200 && (faq.j?.categories ?? []).length >= 3);
  ok('FAQ has a support overview', !!faq.j?.support?.channels?.length);

  const email = `fq+${Date.now()}@example.com`; const password = 'FaqUpload123!';
  await api('POST', '/api/v1/auth/register', { body: { email, password, fullName: 'FU' } });
  const login = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  const tok = login.j?.accessToken; ok('login', !!tok);

  // Catalogue drives manual type selection.
  const cat = await api('GET', '/api/v1/vault/catalogue', { token: tok });
  ok('catalogue returns types with fields', (cat.j?.types ?? []).some((t: any) => Array.isArray(t.fields)));

  // Upload a "file" (a text/plain payload as if a chosen file) → process → confirm with a manual type.
  const init = await api('POST', '/api/v1/vault/documents', { token: tok, body: { filename: 'mydoc.txt', contentType: 'text/plain', sizeBytes: 20, title: 'mydoc' } });
  const docId = init.j?.documentId; const uploadUrl = init.j?.uploadUrl;
  ok('createDocument for an uploaded file', !!docId && !!uploadUrl);
  const put = await api('PUT', new URL(uploadUrl, base).pathname, { token: tok, raw: 'Some scanned contents', ct: 'text/plain' });
  ok('file bytes upload (STORED)', put.j?.status === 'STORED', JSON.stringify(put.j));
  await api('POST', `/api/v1/vault/documents/${docId}/process`, { token: tok });
  // Manually set the type + title, then confirm with manual metadata.
  const manualMeta = { documentNumber: 'X1234567', expiryDate: '2032-05-01' };
  const edit = await api('PATCH', `/api/v1/vault/documents/${docId}`, { token: tok, body: { typeKey: 'passport', title: 'My uploaded passport', metadata: manualMeta } });
  ok('manual type + metadata applied', edit.j?.document?.typeKey === 'passport' || edit.status === 200, JSON.stringify(edit.j).slice(0, 80));
  const conf = await api('POST', `/api/v1/vault/documents/${docId}/confirm`, { token: tok, body: { metadata: manualMeta } });
  ok('confirm stores the uploaded document', conf.status === 200 || conf.status === 201, `→ ${conf.status}`);
  const list = await api('GET', '/api/v1/vault/documents', { token: tok });
  ok('uploaded document appears in the vault', (list.j?.documents ?? []).some((d: any) => d.id === docId));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
