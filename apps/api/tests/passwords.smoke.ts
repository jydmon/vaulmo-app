/**
 * Password vault smoke test (SEC-30).
 *
 * Proves: encrypted at rest, list never leaks the secret, owner can reveal,
 * a DIFFERENT user in the same-nothing context cannot reach it, update re-encrypts,
 * delete works. Also checks the stored cipher is not the plaintext.
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { secureItems } from '../src/db/schema';

const PORT = 4105; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function register(tag: string) {
  const email = `${tag}+${Date.now()}${Math.floor(performance.now())}@example.com`; const password = 'PwUser1234!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: tag });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  return login.j?.accessToken as string;
}

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  const alice = await register('alice');
  const bob = await register('bob');
  ok('two users registered', !!alice && !!bob);

  const SECRET = 'Sup3rSecret!x9';
  const created = await api('POST', '/api/v1/passwords', alice, {
    kind: 'login', label: 'Gmail', username: 'alice@example.com', url: 'https://mail.google.com',
    secret: { password: SECRET, note: 'recovery in drawer' },
  });
  ok('create returns 201 with no secret in the body', created.status === 201 && !JSON.stringify(created.j).includes(SECRET), `→ ${created.status}`);
  const id = created.j?.item?.id;

  // List never includes the secret.
  const list = await api('GET', '/api/v1/passwords', alice);
  ok('list shows the item metadata', (list.j?.items ?? []).some((i: any) => i.id === id && i.label === 'Gmail'));
  ok('list never leaks the secret', !JSON.stringify(list.j).includes(SECRET));

  // Stored ciphertext is not the plaintext.
  const [row] = await db.select().from(secureItems).where(eq(secureItems.id, id)).limit(1);
  ok('secret is encrypted at rest (cipher ≠ plaintext)', !!row && !row.secretCipher.includes(SECRET) && row.secretCipher.split('.').length === 3);

  // Owner can reveal.
  const reveal = await api('POST', `/api/v1/passwords/${id}/reveal`, alice);
  ok('owner reveal returns the decrypted secret', reveal.status === 200 && reveal.j?.secret?.password === SECRET, `→ ${reveal.status}`);

  // A different user cannot see it in their list, nor reveal it (strict access).
  const bobList = await api('GET', '/api/v1/passwords', bob);
  ok('another user does not see the item', !(bobList.j?.items ?? []).some((i: any) => i.id === id));
  const bobReveal = await api('POST', `/api/v1/passwords/${id}/reveal`, bob);
  ok('another user cannot reveal it (404)', bobReveal.status === 404, `→ ${bobReveal.status}`);

  // Update re-encrypts a new password.
  const NEW = 'Rotated#2026';
  const upd = await api('PATCH', `/api/v1/passwords/${id}`, alice, { secret: { password: NEW } });
  ok('update succeeds', upd.status === 200);
  const reveal2 = await api('POST', `/api/v1/passwords/${id}/reveal`, alice);
  ok('reveal returns the rotated password', reveal2.j?.secret?.password === NEW);

  // Delete.
  const del = await api('DELETE', `/api/v1/passwords/${id}`, alice);
  ok('delete succeeds', del.status === 200 && del.j?.deleted === true);
  const after = await api('POST', `/api/v1/passwords/${id}/reveal`, alice);
  ok('deleted item can no longer be revealed (404)', after.status === 404);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
