/**
 * PDF OCR smoke test (AIX-02).
 *
 * Proves the two real PDF paths through the vault process pipeline:
 *   - digital.pdf  → embedded text pulled via pdftotext           (engine 'pdf-text')
 *   - scanned.pdf  → image-only PDF rasterised + OCR'd by Tesseract (engine 'pdf-ocr')
 *
 * Requires poppler-utils + tesseract-ocr (installed in the API image). Fixtures live
 * in tests/fixtures and were generated with reportlab / PIL + img2pdf.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';

const PORT = 4103; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };

async function api(method: string, url: string, opts: { token?: string; body?: any } = {}) {
  const h: any = {}; if (opts.token) h.authorization = `Bearer ${opts.token}`;
  let body: any; if (opts.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const r = await fetch(base + url, { method, headers: h, body });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function putBytes(url: string, bytes: Uint8Array, token: string) {
  const r = await fetch(base + url, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' }, body: bytes });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}

// Register → create document → upload the PDF bytes → process → return the process result.
async function ingestPdf(token: string, file: string, bytes: Uint8Array) {
  const init = await api('POST', '/api/v1/vault/documents', { token, body: { filename: file, contentType: 'application/pdf', sizeBytes: bytes.length, title: file } });
  const docId = init.j?.documentId; const uploadUrl = init.j?.uploadUrl;
  const put = await putBytes(new URL(uploadUrl, base).pathname, bytes, token);
  const proc = await api('POST', `/api/v1/vault/documents/${docId}/process`, { token });
  const doc = await api('GET', `/api/v1/vault/documents/${docId}`, { token });
  return { docId, stored: put.j?.status === 'STORED', proc: proc.j, ocrText: doc.j?.document?.ocrText ?? '' };
}

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  const email = `pdf+${Date.now()}@example.com`; const password = 'PdfUser123!';
  await api('POST', '/api/v1/auth/register', { body: { email, password, fullName: 'PDF User' } });
  const login = await api('POST', '/api/v1/auth/login', { body: { email, password } });
  const tok = login.j?.accessToken; ok('login', !!tok);

  const fx = (f: string) => path.join(process.cwd(), 'tests', 'fixtures', f);
  const digital = new Uint8Array(await readFile(fx('digital.pdf')));
  const scanned = new Uint8Array(await readFile(fx('scanned.pdf')));
  const multipage = new Uint8Array(await readFile(fx('multipage.pdf')));

  // 1) Digital PDF — pdftotext pulls the embedded text layer.
  const d = await ingestPdf(tok, 'digital.pdf', digital);
  ok('digital PDF stored', d.stored, JSON.stringify(d.proc).slice(0, 80));
  ok('digital PDF uses the pdf-text engine', d.proc?.engine === 'pdf-text', `→ ${d.proc?.engine}`);
  ok('digital PDF reports a page count', (d.proc?.pages ?? 0) >= 1, `→ ${d.proc?.pages}`);
  ok('digital PDF text extracted (policy number present)', /POL-DIGITAL-4471/.test(d.ocrText), d.ocrText.slice(0, 60));

  // 2) Scanned (image-only) PDF — rasterised then OCR'd by Tesseract.
  const s = await ingestPdf(tok, 'scanned.pdf', scanned);
  ok('scanned PDF stored', s.stored, JSON.stringify(s.proc).slice(0, 80));
  ok('scanned PDF uses the pdf-ocr engine', s.proc?.engine === 'pdf-ocr', `→ ${s.proc?.engine}`);
  ok('scanned PDF OCR recovered the order number', /SCAN-8892/i.test(s.ocrText), s.ocrText.replace(/\s+/g, ' ').slice(0, 80));
  ok('scanned PDF OCR recovered the merchant', /currys/i.test(s.ocrText), s.ocrText.replace(/\s+/g, ' ').slice(0, 80));

  // 3) Multi-page scan (VLT-05 server contract) — a 2-page image-only PDF, exactly
  //    what the mobile "Scan multiple pages" flow builds, OCRs every page.
  const mp = await ingestPdf(tok, 'multipage.pdf', multipage);
  ok('multi-page PDF stored', mp.stored, JSON.stringify(mp.proc).slice(0, 80));
  ok('multi-page PDF uses the pdf-ocr engine', mp.proc?.engine === 'pdf-ocr', `→ ${mp.proc?.engine}`);
  ok('multi-page PDF reports 2 pages', mp.proc?.pages === 2, `→ ${mp.proc?.pages}`);
  ok('OCR recovered text from page 1', /MULTIPAGE-P1/i.test(mp.ocrText), mp.ocrText.replace(/\s+/g, ' ').slice(0, 100));
  ok('OCR recovered text from page 2', /MULTIPAGE-P2/i.test(mp.ocrText), mp.ocrText.replace(/\s+/g, ' ').slice(0, 100));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
