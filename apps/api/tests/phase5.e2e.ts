/**
 * Phase 5 — AI Assistant (permission-scoped RAG) end-to-end proof.
 * Proves: document/metadata/full-text search, RAG answers with source references,
 * "What do I need to know?", and the CRITICAL guarantee — every answer is drawn only
 * from the caller's own tenant data; another user cannot retrieve it.
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';

const PORT = 4013;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d && '— ' + d}`)); };

async function api(method: string, url: string, o: { body?: unknown; token?: string; raw?: Buffer } = {}) {
  const h: Record<string, string> = {};
  if (o.token) h.authorization = `Bearer ${o.token}`;
  let body: string | Buffer | undefined;
  if (o.raw) { h['content-type'] = 'text/plain'; body = o.raw; }
  else if (o.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(o.body); }
  const res = await fetch(url.startsWith('http') ? url : base + url, { method, headers: h, body });
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: res.status, json: j };
}
const login = async (e: string, p: string) => (await api('POST', '/api/v1/auth/login', { body: { email: e, password: p } })).json?.accessToken;

async function makeTester(): Promise<string> {
  const email = `t+${Math.random().toString(36).slice(2)}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'Tester12345!', fullName: 'Tester' } });
  await db.update(users).set({ isInternalTester: true }).where(eq(users.id, reg.json.user.id));
  return login(email, 'Tester12345!');
}
async function scanConfirm(token: string, filename: string, text: string) {
  const bytes = Buffer.from(text);
  const init = await api('POST', '/api/v1/vault/documents', { token, body: { filename, contentType: 'text/plain', sizeBytes: bytes.length } });
  await api('PUT', init.json.uploadUrl, { token, raw: bytes });
  await api('POST', `/api/v1/vault/documents/${init.json.documentId}/process`, { token });
  await api('POST', `/api/v1/vault/documents/${init.json.documentId}/confirm`, { token, body: {} });
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  const sa = await login('admin@lifehub.local', 'ChangeMe123!');

  const A = await makeTester();
  const B = await makeTester();
  check('two pilot users signed in', !!A && !!B);

  // A owns a passport (unique number) and a home insurance (unique policy number).
  await scanConfirm(A, 'passport.txt', 'UNITED KINGDOM\nPASSPORT\nType P Code GBR\nPassport No: 546872331\nNationality: British\nGiven names: SARAH JANE\nDate of expiry: 22 Mar 2027');
  await scanConfirm(A, 'home.txt', 'AVIVA HOME INSURANCE\nInsurer: Aviva\nPolicy Number: HM-4471-9920\nRenewal date: 05 Sep 2026');

  console.log('\nDOCUMENT + METADATA + SEMANTIC SEARCH (own data)');
  const s1 = await api('POST', '/api/v1/assistant/search', { token: A, body: { query: 'passport' } });
  check('A can find their passport by keyword', (s1.json.results ?? []).some((r: any) => r.typeKey === 'passport'));
  const s2 = await api('POST', '/api/v1/assistant/search', { token: A, body: { query: 'HM-4471-9920' } });
  check('A can find a document by its metadata (policy number)', (s2.json.results ?? []).some((r: any) => r.typeKey === 'home_insurance'));

  console.log('\nRAG ASSISTANT + SOURCE REFERENCES');
  const ask1 = await api('POST', '/api/v1/assistant/ask', { token: A, body: { question: 'When does my passport expire?' } });
  check('assistant answers the expiry question', /2027-03-22/.test(ask1.json.answer), ask1.json.answer);
  check('answer includes a source reference', (ask1.json.sources ?? []).some((s: any) => /passport/i.test(s.ref)));

  console.log('\n"WHAT DO I NEED TO KNOW?"');
  const brief = await api('GET', '/api/v1/assistant/whats-important', { token: A });
  check('brief summarises the user\'s situation', typeof brief.json.summary === 'string' && brief.json.summary.length > 0);
  check('brief lists outstanding recommended documents', Array.isArray(brief.json.outstanding) && brief.json.outstanding.length > 0);

  console.log('\nPERMISSION ISOLATION (the critical guarantee)');
  const bSearch = await api('POST', '/api/v1/assistant/search', { token: B, body: { query: '546872331' } });
  check('B CANNOT find A\'s passport number', (bSearch.json.results ?? []).length === 0, `got ${bSearch.json.results?.length}`);
  const bSearch2 = await api('POST', '/api/v1/assistant/search', { token: B, body: { query: 'HM-4471-9920' } });
  check('B CANNOT find A\'s policy number', (bSearch2.json.results ?? []).length === 0);
  const bAsk = await api('POST', '/api/v1/assistant/ask', { token: B, body: { question: 'When does my passport expire?' } });
  check('B\'s assistant returns nothing (no access to A\'s data)', bAsk.json.retrieved === 0 && /couldn't find/i.test(bAsk.json.answer), bAsk.json.answer);
  check('A can still retrieve their own passport (control)', (await api('POST', '/api/v1/assistant/search', { token: A, body: { query: '546872331' } })).json.results.length >= 1);

  console.log('\nGATE + AUDIT');
  const outEmail = `out+${Date.now()}@x.com`;
  await api('POST', '/api/v1/auth/register', { body: { email: outEmail, password: 'Outsider12345!', fullName: 'Out' } });
  const outsider = await login(outEmail, 'Outsider12345!');
  const denied = await api('POST', '/api/v1/assistant/ask', { token: outsider, body: { question: 'hi' } });
  check('non-pilot user blocked from the assistant (403)', denied.status === 403);
  const auditLog = await api('GET', '/api/v1/admin/audit?limit=200', { token: sa });
  check('assistant queries are audited', (auditLog.json.logs ?? []).some((l: any) => l.action === 'assistant.ask'));

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}\n  RESULT: ${passed} passed, ${failed} failed\n${'='.repeat(48)}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
