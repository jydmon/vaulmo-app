import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const exec = promisify(execFile);

// OCR abstraction. Two drivers behind one call:
//  - text  : the file already IS text (synthetic test documents, .txt/.md, exports)
//  - image : real OCR via Tesseract for scanned images (JPEG/PNG/TIFF)
//
// This keeps internal-alpha testing deterministic with synthetic text documents,
// while proving genuine OCR on scanned images where Tesseract is available.
export interface OcrResult {
  text: string;
  engine: 'text' | 'tesseract';
}

export async function ocrExtractText(buf: Buffer, contentType: string, filename = ''): Promise<OcrResult> {
  const ct = contentType.toLowerCase();
  const isText = ct.startsWith('text/') || ct === 'application/json' || /\.(txt|md|csv)$/i.test(filename);
  if (isText) {
    return { text: buf.toString('utf8'), engine: 'text' };
  }
  if (ct.startsWith('image/')) {
    return { text: await tesseract(buf, extForContentType(ct)), engine: 'tesseract' };
  }
  // PDFs would be rasterised (pdftoppm) then OCR'd in production; out of scope for
  // the synthetic-document alpha. Fall back to a best-effort utf8 decode.
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
    const { stdout } = await exec('tesseract', [tmp, 'stdout', '--psm', '6'], { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
