/**
 * Accessibility regression check (WCAG 2.2 AA) using axe-core in headless Chromium.
 *
 * Serves the built dist/ and scans the auth screens (login + register) — the surfaces
 * that exercise the app's shared primitives (link-buttons, labelled fields, headings,
 * landmarks, focus styles). Exits non-zero on any violation.
 *
 * Usage:  npm run build && npm run a11y   (from apps/web)
 * Env:    CHROMIUM=/path/to/chrome  overrides the browser executable if needed.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core'), 'utf8');
const DIST = path.resolve('dist');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || !p.includes('.')) p = '/index.html';
    const buf = await readFile(path.join(DIST, p));
    const ext = path.extname(p);
    const ct = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct }); res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(5599, r));

const launch = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
const browser = await chromium.launch(launch);
const page = await browser.newPage();

async function scan(label) {
  await page.evaluate(axeSource);
  const r = await page.evaluate(async (tags) => await window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS);
  return { label, violations: r.violations, passes: r.passes.length };
}

const results = [];
await page.goto('http://127.0.0.1:5599/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
results.push(await scan('login'));
const create = page.getByText('Create an account', { exact: false });
if (await create.count()) { await create.first().click(); await page.waitForTimeout(300); results.push(await scan('register')); }

await browser.close(); server.close();

let failed = 0;
for (const r of results) {
  console.log(`\n[${r.label}] ${r.violations.length ? `${r.violations.length} violation(s)` : 'no violations'} · ${r.passes} axe checks passed`);
  for (const v of r.violations) {
    failed++;
    console.log(`  ✗ ${v.id} (${v.impact}) — ${v.help}`);
    for (const n of v.nodes) console.log(`      ${n.target.join(' ')}`);
  }
}
console.log(failed ? `\nA11Y FAIL: ${failed} violation group(s)\n` : '\nA11Y PASS: 0 violations across auth screens\n');
process.exit(failed ? 1 : 0);
