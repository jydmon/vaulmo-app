/**
 * User-phase smoke test: the new Vault + AI gaps.
 * Proves: metadata provenance, document download, replace/versioning, soft-delete,
 * and cross-entity assistant answers (trips, purchases, warranties).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { auditLogs } from '../src/db/schema';

const PORT = 4021;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d}`)); };

async function api(method: string, url: string, opts: { body?: unknown; token?: string; raw?: string; ct?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.raw !== undefined) { headers['content-type'] = opts.ct ?? 'text/plain'; body = opts.raw; }
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(base + url, { method, headers, body });
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  const email = `up+${Date.now()}@example.com`;
  await api('POST', '/api/v1/auth/register', { body: { email, password: 'UserPhase123!', fullName: 'User Phase' } });
  const login = await api('POST', '/api/v1/auth/login', { body: { email, password: 'UserPhase123!' } });
  const token = login.json?.accessToken;
  check('regular user logs in with a full session', !!token);

  // --- Create + upload + process a document ---
  const init = await api('POST', '/api/v1/vault/documents', { token, body: { filename: 'passport.txt', contentType: 'text/plain', sizeBytes: 120, title: 'My Passport' } });
  const docId = init.json?.documentId;
  await api('PUT', new URL(init.json.uploadUrl, base).pathname, { token, raw: 'UNITED KINGDOM PASSPORT\nPassport No: 123456789\nExpiry date: 2030-05-01\n', ct: 'text/plain' });
  const proc = await api('POST', `/api/v1/vault/documents/${docId}/process`, { token });
  check('process returns AWAITING_CONFIRM', proc.json?.status === 'AWAITING_CONFIRM');

  // --- AIX-07 metadata provenance ---
  const detail1 = await api('GET', `/api/v1/vault/documents/${docId}`, { token });
  const srcs = detail1.json?.metadataSources ?? {};
  const anyAi = Object.values(srcs).includes('ai');
  check('extracted fields carry provenance "ai"', anyAi, JSON.stringify(srcs));

  const patch = await api('PATCH', `/api/v1/vault/documents/${docId}`, { token, body: { metadata: { note: 'added by hand' } } });
  check('edited field carries provenance "manual"', patch.json?.metadataSources?.note === 'manual');

  // --- VLT-07 download (attachment) ---
  const dl = await api('GET', `/api/v1/vault/documents/${docId}/download`, { token });
  check('download returns attachment disposition', (dl.headers.get('content-disposition') ?? '').includes('attachment'));

  // --- VLT-08 replace / versioning ---
  const rep = await api('POST', `/api/v1/vault/documents/${docId}/replace`, { token, body: { filename: 'passport-v2.txt', contentType: 'text/plain', sizeBytes: 120, title: 'My Passport (renewed)' } });
  const v2 = rep.json?.documentId;
  check('replace creates a version 2 linked to v1', rep.json?.version === 2 && rep.json?.previousVersionId === docId);
  const listDefault = await api('GET', '/api/v1/vault/documents', { token });
  const ids = (listDefault.json?.documents ?? []).map((d: any) => d.id);
  check('default list hides the superseded v1', ids.includes(v2) && !ids.includes(docId));
  const listHist = await api('GET', '/api/v1/vault/documents?includeHistory=1', { token });
  const idsH = (listHist.json?.documents ?? []).map((d: any) => d.id);
  check('history list shows both versions', idsH.includes(v2) && idsH.includes(docId));

  // --- VLT-09 soft delete ---
  const del = await api('DELETE', `/api/v1/vault/documents/${v2}`, { token });
  check('delete succeeds', del.json?.deleted === true);
  const afterDel = await api('GET', '/api/v1/vault/documents', { token });
  check('deleted document no longer listed', !(afterDel.json?.documents ?? []).some((d: any) => d.id === v2));
  const detailGone = await api('GET', `/api/v1/vault/documents/${v2}`, { token });
  check('deleted document detail returns 404', detailGone.status === 404);

  // --- AIX-15/16 assistant: purchases + warranty ---
  await api('POST', '/api/v1/purchases', { token, body: { item: 'Bosch washing machine', merchant: 'Currys', amount: '£499', purchaseDate: '2025-01-10', warrantyExpiry: '2035-01-10' } });
  const warranty = await api('POST', '/api/v1/assistant/ask', { token, body: { question: 'Is my washing machine still under warranty?' } });
  check('assistant answers a warranty question from purchases', /warranty/i.test(warranty.json?.answer ?? '') && (warranty.json?.retrieved ?? 0) > 0, warranty.json?.answer);
  const receipt = await api('POST', '/api/v1/assistant/ask', { token, body: { question: 'Find the receipt for my washing machine' } });
  check('assistant answers a receipt question from purchases', /Currys|washing machine/i.test(receipt.json?.answer ?? ''), receipt.json?.answer);

  // --- AIX-14 assistant: trips ---
  await api('POST', '/api/v1/trips', { token, body: { title: 'Paris break', destination: 'Paris', startDate: '2026-09-10', endDate: '2026-09-14' } });
  const trip = await api('POST', '/api/v1/assistant/ask', { token, body: { question: 'What trips do I have coming up?' } });
  check('assistant answers a trip question from trips', /Paris/i.test(trip.json?.answer ?? ''), trip.json?.answer);

  // --- audit events were written (read directly, bypassing MFA-gated admin endpoint) ---
  const events = await db.select().from(auditLogs).where(inArray(auditLogs.action, ['document.extracted', 'document.confirmed', 'document.replaced', 'document.deleted', 'document.downloaded'])).orderBy(desc(auditLogs.at)).limit(50);
  const actions = new Set(events.map((e) => e.action));
  check('extraction + replace + delete + download audited', actions.has('document.extracted') && actions.has('document.replaced') && actions.has('document.deleted') && actions.has('document.downloaded'), [...actions].join(','));

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed\n`);
  server.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
