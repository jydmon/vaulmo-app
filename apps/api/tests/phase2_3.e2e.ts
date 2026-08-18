/**
 * Phase 2 (Digital Vault) + Phase 3 (AI Document Intelligence) end-to-end proof.
 *
 * Proves: country catalogue + checklist + completion score, upload, real OCR
 * (Tesseract) + text OCR on synthetic docs, classification, metadata extraction,
 * editing, the Scan→Extract→Confirm→Store flow, the internal-tester gate, and the
 * critical rule: extracted dates create DRAFT reminders that only go LIVE on confirm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';

const PORT = 4011;
const base = `http://127.0.0.1:${PORT}`;
const FIX = path.join(process.cwd(), 'tests', 'fixtures');

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`); }
}

async function api(method: string, url: string, opts: { body?: unknown; token?: string; raw?: Buffer; contentType?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | Buffer | undefined;
  if (opts.raw) { headers['content-type'] = opts.contentType ?? 'application/octet-stream'; body = opts.raw; }
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(url.startsWith('http') ? url : base + url, { method, headers, body });
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

async function login(email: string, password: string): Promise<string> {
  const r = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  return r.json?.accessToken;
}

// Create a document, upload its bytes, run processing. Returns the process result + docId.
async function scan(token: string, filename: string, contentType: string, bytes: Buffer) {
  const init = await api('POST', '/api/v1/vault/documents', { token, body: { filename, contentType, sizeBytes: bytes.length } });
  const docId = init.json.documentId;
  await api('PUT', init.json.uploadUrl, { token, raw: bytes, contentType });
  const proc = await api('POST', `/api/v1/vault/documents/${docId}/process`, { token });
  return { docId, proc };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  // Fresh internal-tester tenant per run (isolated so before/after deltas are exact).
  const testerEmail = `tester+${Date.now()}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email: testerEmail, password: 'Tester123!', fullName: 'Alpha Tester' } });
  const userId = reg.json?.user?.id;
  await db.update(users).set({ isInternalTester: true }).where(eq(users.id, userId)); // elevate to internal tester
  const token = await login(testerEmail, 'Tester123!');
  check('internal tester can sign in', !!token);

  console.log('\nPHASE 2 — CATALOGUE (country-specific)');
  const cat = await api('GET', '/api/v1/vault/catalogue', { token });
  check('catalogue is scoped to GB', cat.json?.country === 'GB');
  const keys = (cat.json?.types ?? []).map((t: any) => t.key);
  check('GB catalogue includes UK driving licence', keys.includes('driving_licence'));
  check('GB catalogue excludes US driver license', !keys.includes('drivers_license_us'));

  console.log('\nPHASE 2 — CHECKLIST & COMPLETION SCORE (before)');
  const before = await api('GET', '/api/v1/vault/checklist', { token });
  const scoreBefore = before.json?.completionScore;
  check('completion score is a number', typeof scoreBefore === 'number', `got ${scoreBefore}`);
  check('outstanding documents are tracked', Array.isArray(before.json?.outstanding));

  console.log('\nPHASE 3 — SCAN → EXTRACT (synthetic passport, text OCR)');
  const passportTxt = fs.readFileSync(path.join(FIX, 'passport.txt'));
  const p = await scan(token, 'passport.txt', 'text/plain', passportTxt);
  check('OCR engine used = text (synthetic doc)', p.proc.json?.engine === 'text');
  check('classified as passport', p.proc.json?.classification?.typeKey === 'passport', JSON.stringify(p.proc.json?.classification));
  const fields = p.proc.json?.extracted ?? [];
  const expiry = fields.find((f: any) => f.key === 'expiryDate');
  const num = fields.find((f: any) => f.key === 'documentNumber');
  check('extracted expiry date normalised to 2027-03-22', expiry?.value === '2027-03-22', expiry?.value);
  check('extracted passport number', num?.value === '546872331', num?.value);
  check('status is AWAITING_CONFIRM after extract', p.proc.json?.status === 'AWAITING_CONFIRM');
  check('a DRAFT reminder was created from the date', (p.proc.json?.draftReminders ?? []).length >= 1);

  console.log('\nPHASE 3 — REMINDER GATE (must not be live before confirm)');
  const remBefore = await api('GET', '/api/v1/vault/reminders', { token });
  check('reminder is DRAFT, not live, before confirmation', (remBefore.json?.live ?? []).length === 0 && (remBefore.json?.draft ?? []).length >= 1,
    `live=${remBefore.json?.live?.length} draft=${remBefore.json?.draft?.length}`);

  console.log('\nPHASE 3 — CONFIRM → STORE (activates reminder)');
  const conf = await api('POST', `/api/v1/vault/documents/${p.docId}/confirm`, { token, body: {} });
  check('confirm stores the document (CONFIRMED)', conf.json?.status === 'CONFIRMED', JSON.stringify(conf.json));
  check('confirm activated the reminder', conf.json?.remindersActivated >= 1);
  const remAfter = await api('GET', '/api/v1/vault/reminders', { token });
  check('reminder is now LIVE after confirmation', (remAfter.json?.live ?? []).length >= 1);
  const detail = await api('GET', `/api/v1/vault/documents/${p.docId}`, { token });
  check('confirmed metadata is stored', detail.json?.document?.confirmedMetadata?.expiryDate === '2027-03-22');
  check('preview URL is available', !!detail.json?.previewUrl);

  console.log('\nPHASE 3 — METADATA EDITING (edit before confirm)');
  const ins = await scan(token, 'home_insurance.txt', 'text/plain', fs.readFileSync(path.join(FIX, 'home_insurance.txt')));
  check('home insurance classified', ins.proc.json?.classification?.typeKey === 'home_insurance');
  const renew = (ins.proc.json?.extracted ?? []).find((f: any) => f.key === 'renewalDate');
  check('renewal date extracted (2027-09-05)', renew?.value === '2027-09-05', renew?.value);
  await api('PATCH', `/api/v1/vault/documents/${ins.docId}`, { token, body: { metadata: { provider: 'Aviva plc (edited)' } } });
  const confIns = await api('POST', `/api/v1/vault/documents/${ins.docId}/confirm`, { token, body: {} });
  check('edited metadata is preserved on confirm', confIns.json?.confirmedMetadata?.provider === 'Aviva plc (edited)', JSON.stringify(confIns.json?.confirmedMetadata));

  console.log('\nPHASE 3 — REAL OCR (Tesseract on a scanned image)');
  const png = fs.readFileSync(path.join(FIX, 'passport.png'));
  const img = await scan(token, 'passport.png', 'image/png', png);
  check('OCR engine used = tesseract (scanned image)', img.proc.json?.engine === 'tesseract', img.proc.json?.engine);
  check('scanned image classified as passport', img.proc.json?.classification?.typeKey === 'passport');
  const imgNum = (img.proc.json?.extracted ?? []).find((f: any) => f.key === 'documentNumber');
  check('metadata extracted from the real OCR text', imgNum?.value === '546872331', imgNum?.value);

  console.log('\nPHASE 3 — CONFIRM GUARD (required fields)');
  const partial = await scan(token, 'partial.txt', 'text/plain', Buffer.from('PASSPORT\nNationality: British\nGiven names: SARAH'));
  const badConfirm = await api('POST', `/api/v1/vault/documents/${partial.docId}/confirm`, { token, body: {} });
  check('cannot confirm without required fields (422)', badConfirm.status === 422, `status ${badConfirm.status}`);

  console.log('\nPHASE 2 — COMPLETION SCORE (after) & OUTSTANDING');
  const after = await api('GET', '/api/v1/vault/checklist', { token });
  check('completion score increased after confirming documents', after.json?.completionScore > scoreBefore,
    `${scoreBefore} → ${after.json?.completionScore}`);
  check('outstanding shrank', (after.json?.outstanding?.length ?? 99) < (before.json?.outstanding?.length ?? 0));

  console.log('\nINTERNAL-TESTER GATE (alpha restriction)');
  const email = `outsider+${Date.now()}@example.com`;
  await api('POST', '/api/v1/auth/register', { body: { email, password: 'Outsider123!', fullName: 'Not A Tester' } });
  const outsider = await login(email, 'Outsider123!');
  const denied = await api('GET', '/api/v1/vault/catalogue', { token: outsider });
  check('non-tester is blocked from the vault (403)', denied.status === 403 && denied.json?.error === 'not_internal_tester');

  console.log('\nAUDIT TRAIL');
  const sa = await login('admin@lifehub.local', 'ChangeMe123!');
  const auditLog = await api('GET', '/api/v1/admin/audit?limit=200', { token: sa });
  const actions = (auditLog.json?.logs ?? []).map((l: any) => l.action);
  check('extraction event audited', actions.includes('document.extracted'));
  check('confirmation event audited', actions.includes('document.confirmed'));

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}`);
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(48));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
