import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);

// Passport-photo processor bridge (VLT-10). Shells out to scripts/passport.py
// (OpenCV: face detect + grabCut segmentation + white background + compliant crop).
// The script ships in the API image alongside the tesseract/poppler tooling.
export interface PassportMeta { facesDetected: number; width: number; height: number; segmented: boolean }
export interface PassportResult { image: Buffer; meta: PassportMeta }

const SCRIPT = path.join(process.cwd(), 'scripts', 'passport.py');

export async function processPassportPhoto(input: Buffer): Promise<PassportResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'passport-'));
  const inPath = path.join(dir, 'in.img');
  const outPath = path.join(dir, 'out.jpg');
  try {
    await writeFile(inPath, input);
    const { stdout } = await exec('python3', [SCRIPT, inPath, outPath], { maxBuffer: 8 * 1024 * 1024 });
    let meta: PassportMeta;
    try { meta = JSON.parse(stdout.trim().split('\n').pop() || '{}'); } catch { meta = { facesDetected: 0, width: 600, height: 771, segmented: false }; }
    if ((meta as any).error) throw new Error((meta as any).error);
    const image = await readFile(outPath);
    return { image, meta };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
