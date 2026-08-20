import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, readdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const exec = promisify(execFile);

// OCR abstraction. Drivers behind one call:
//  - text      : the file already IS text (synthetic test documents, .txt/.md, exports)
//  - tesseract : real OCR via Tesseract for scanned images (JPEG/PNG/TIFF)
//  - pdf-text  : embedded text pulled straight out of a digital PDF (pdftotext)
//  - pdf-ocr   : scanned/image PDF rasterised to PNG per page (pdftoppm) then OCR'd
//
// This keeps internal-alpha testing deterministic with synthetic text documents,
// while proving genuine OCR on scanned images and PDFs where the tools are available.
export interface OcrResult {
  text: string;
  engine: 'text' | 'tesseract' | 'pdf-text' | 'pdf-ocr';
  pages?: number;
}

// A PDF page needs OCR when pdftotext returns little or nothing (scanned image PDF).
// Digital PDFs (bank statements, exports) carry real text and skip the slow raster path.
const MIN_EMBEDDED_TEXT = 24; // chars of real text below which we treat the PDF as scanned

export async function ocrExtractText(buf: Buffer, contentType: string, filename = ''): Promise<OcrResult> {
  const ct = contentType.toLowerCase();
  const isText = ct.startsWith('text/') || ct === 'application/json' || /\.(txt|md|csv)$/i.test(filename);
  if (isText) {
    return { text: buf.toString('utf8'), engine: 'text' };
  }
  if (ct.startsWith('image/')) {
    return { text: await tesseract(buf, extForContentType(ct)), engine: 'tesseract' };
  }
  if (ct === 'application/pdf' || /\.pdf$/i.test(filename)) {
    return await extractPdf(buf);
  }
  // Unknown binary — best-effort utf8 decode so nothing hard-fails.
  return { text: buf.toString('utf8'), engine: 'text' };
}

function extForContentType(ct: string): string {
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('tiff')) return 'tiff';
  return 'png';
}

async function tesseract(buf: Buffer, ext: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `ocr-${crypto.randomUUID()}.${ext}`);
  await writeFile(tmp, buf);
  try {
    const { stdout } = await exec('tesseract', [tmp, 'stdout', '--psm', '6'], { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// PDF pipeline: try fast embedded-text extraction first; if the PDF is scanned
// (little/no embedded text) rasterise each page and OCR it with Tesseract.
// Falls back gracefully — if poppler isn't present we degrade to a utf8 decode
// rather than throwing, so the app still stores the document.
async function extractPdf(buf: Buffer): Promise<OcrResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pdf-'));
  const src = path.join(dir, 'in.pdf');
  await writeFile(src, buf);
  try {
    // 1) Digital PDF? Pull embedded text — fast and lossless.
    const embedded = await pdftotext(src).catch(() => '');
    if (embedded.replace(/\s/g, '').length >= MIN_EMBEDDED_TEXT) {
      return { text: embedded, engine: 'pdf-text', pages: countFormFeeds(embedded) };
    }
    // 2) Scanned PDF — rasterise pages to PNG then OCR each.
    const ocr = await ocrScannedPdf(src, dir);
    if (ocr.text.replace(/\s/g, '').length > 0) return ocr;
    // 3) Nothing recoverable — return whatever embedded text we had (may be empty).
    return { text: embedded, engine: 'pdf-text', pages: countFormFeeds(embedded) };
  } catch {
    // poppler/tesseract unavailable — degrade without failing the upload.
    return { text: buf.toString('utf8'), engine: 'text' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function pdftotext(src: string): Promise<string> {
  // -layout preserves column/row structure so downstream field extraction fares better.
  const { stdout } = await exec('pdftotext', ['-layout', '-enc', 'UTF-8', src, '-'], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

// pdftoppm renders each PDF page to a PNG (out-1.png, out-2.png, ...). We OCR each,
// capping page count so a huge PDF can't run OCR forever.
const MAX_OCR_PAGES = 15;
async function ocrScannedPdf(src: string, dir: string): Promise<OcrResult> {
  const prefix = path.join(dir, 'page');
  // 200 DPI is a good accuracy/speed trade-off for document OCR; grayscale keeps files small.
  await exec('pdftoppm', ['-png', '-r', '200', '-gray', src, prefix], { maxBuffer: 40 * 1024 * 1024 });
  const files = (await readdir(dir))
    .filter((f) => f.startsWith('page') && f.endsWith('.png'))
    .sort((a, b) => pageNum(a) - pageNum(b))
    .slice(0, MAX_OCR_PAGES);
  const parts: string[] = [];
  for (const f of files) {
    const png = await readFile(path.join(dir, f));
    parts.push(await tesseract(png, 'png').catch(() => ''));
  }
  return { text: parts.join('\n\n').trim(), engine: 'pdf-ocr', pages: files.length };
}

function pageNum(f: string): number {
  const m = f.match(/(\d+)\.png$/);
  return m ? parseInt(m[1], 10) : 0;
}

// pdftotext separates pages with a form-feed (\f); count them to report page count.
function countFormFeeds(text: string): number {
  if (!text) return 0;
  const ff = (text.match(/\f/g) || []).length;
  return Math.max(1, ff + (text.replace(/\f/g, '').trim() ? 1 : 0) - (text.endsWith('\f') ? 1 : 0)) || 1;
}
