/**
 * Passport-photo tool smoke test (VLT-10).
 *
 * Generates a synthetic head-and-shoulders portrait on a coloured background, sends it
 * to POST /passport/process, and checks the result is a compliant passport photo:
 * 35:45 output size, background whitened to the corners, and (with ?save=1) stored in
 * the vault as a document. Requires python3 + OpenCV in the API image.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app';
import { pool } from '../src/db/client';

const PORT = 4106; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}

// Build a simple portrait (skin ellipse + eyes/mouth + shoulders) on a blue background.
function makePortrait(): Buffer {
  const py = `
from PIL import Image, ImageDraw
img = Image.new("RGB", (800,1000), (60,110,190))
d = ImageDraw.Draw(img)
d.rectangle([250,720,550,1000], fill=(40,40,60))
d.ellipse([300,300,500,560], fill=(226,192,165))
d.ellipse([345,400,375,430], fill=(30,30,30)); d.ellipse([425,400,455,430], fill=(30,30,30))
d.arc([370,470,430,520], 20,160, fill=(120,60,60), width=6)
import sys; img.save(sys.argv[1])
`;
  const scriptPath = path.join(os.tmpdir(), `mkportrait-${Date.now()}.py`);
  const outPath = path.join(os.tmpdir(), `portrait-${Date.now()}.png`);
  writeFileSync(scriptPath, py);
  execFileSync('python3', [scriptPath, outPath]);
  return readFileSync(outPath);
}

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  const email = `pp+${Date.now()}@example.com`; const password = 'PassPhoto123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'PP User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const tok = login.j?.accessToken;
  ok('login', !!tok);

  const portrait = makePortrait();
  ok('synthetic portrait generated', portrait.length > 1000);

  // Process (no save): expect a base64 preview + 600x771 meta.
  const r = await fetch(`${base}/api/v1/passport/process`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'image/png' }, body: portrait });
  const j: any = await r.json();
  ok('process returns 200', r.status === 200, `→ ${r.status} ${JSON.stringify(j).slice(0, 80)}`);
  ok('output is 35:45 passport size (600x771)', j?.meta?.width === 600 && j?.meta?.height === 771, JSON.stringify(j?.meta));
  ok('returns a JPEG preview data URL', typeof j?.preview === 'string' && j.preview.startsWith('data:image/jpeg;base64,'));

  // Verify the processed image corners are white (background removed). Decode + inspect via python.
  const b64 = (j?.preview ?? '').split(',')[1] ?? '';
  const outImg = path.join(os.tmpdir(), `ppout-${Date.now()}.jpg`);
  writeFileSync(outImg, Buffer.from(b64, 'base64'));
  const check = execFileSync('python3', ['-c', `
from PIL import Image
import numpy as np, sys
a = np.array(Image.open(sys.argv[1]).convert("RGB"))
tl = a[0:20,0:20].mean(); tr = a[0:20,-20:].mean()
print("WHITE" if (tl>245 and tr>245) else "NOTWHITE", int(tl), int(tr))
`, outImg]).toString().trim();
  ok('background whitened to the corners', check.startsWith('WHITE'), check);
  ok('face detected on the portrait', (j?.meta?.facesDetected ?? 0) >= 1, `faces=${j?.meta?.facesDetected}`);

  // Process + save to vault: expect a documentId and the doc to appear in the vault.
  const r2 = await fetch(`${base}/api/v1/passport/process?save=1`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'image/png' }, body: portrait });
  const j2: any = await r2.json();
  ok('process?save=1 stores a document', r2.status === 200 && !!j2?.documentId, `→ ${r2.status}`);
  const list = await api('GET', '/api/v1/vault/documents', tok);
  ok('saved passport photo appears in the vault', (list.j?.documents ?? []).some((d: any) => d.id === j2?.documentId));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
