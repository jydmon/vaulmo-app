/**
 * Communications smoke test: broadcast board, in-app support chat, website bot + hand-off.
 */
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';

const PORT = 4112; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function adminSession(): Promise<string> {
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.email, 'admin@lifehub.local'));
  const l = await api('POST', '/api/v1/auth/login', undefined, { email: 'admin@lifehub.local', password: 'ChangeMe123!' });
  const tok = l.j?.accessToken;
  const enroll = await api('POST', '/api/v1/mfa/enroll', tok, {});
  const conf = await api('POST', '/api/v1/mfa/confirm', tok, { code: authenticator.generate(enroll.j.secret) });
  return conf.j?.accessToken ?? tok;
}
// Register + login a normal user (mfa is off for fresh accounts).
async function userSession(): Promise<string> {
  const email = `comms+${Date.now()}@example.com`;
  await api('POST', '/api/v1/auth/register', undefined, { email, password: 'CommsUser123!', fullName: 'Chatty User' });
  const l = await api('POST', '/api/v1/auth/login', undefined, { email, password: 'CommsUser123!' });
  return l.j?.accessToken;
}

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));
  const tok = await adminSession();
  const utok = await userSession();
  ok('sessions obtained', !!tok && !!utok);

  // --- Broadcast message board ---
  const title = `Launch ${Date.now()}`;
  const create = await api('POST', '/api/v1/admin/comms/broadcasts', tok, { title, body: 'The passport photo tool is live!', level: 'info' });
  const bid = create.j?.broadcast?.id;
  ok('admin publishes a broadcast', create.status === 201 && !!bid);
  const nonAdmin = await api('POST', '/api/v1/admin/comms/broadcasts', utok, { title: 'x', body: 'y' });
  ok('non-admin cannot publish (403)', nonAdmin.status === 403, `→ ${nonAdmin.status}`);
  const userView = await api('GET', '/api/v1/comms/broadcasts', utok);
  ok('user sees the broadcast as unread', userView.j?.broadcasts?.some((b: any) => b.id === bid && b.read === false) && userView.j.unread >= 1);
  await api('POST', `/api/v1/comms/broadcasts/${bid}/read`, utok, {});
  const afterRead = await api('GET', '/api/v1/comms/broadcasts', utok);
  ok('marking read clears the unread flag', afterRead.j?.broadcasts?.find((b: any) => b.id === bid)?.read === true);
  const adminList = await api('GET', '/api/v1/admin/comms/broadcasts', tok);
  ok('admin sees read count', (adminList.j?.broadcasts ?? []).find((b: any) => b.id === bid)?.readCount >= 1);

  // --- In-app support chat (user ↔ staff) ---
  const post = await api('POST', '/api/v1/comms/chat/messages', utok, { body: 'Hi, I need help importing documents.' });
  ok('user can post to support chat', post.status === 201);
  const inbox = await api('GET', '/api/v1/admin/comms/conversations', tok);
  const conv = (inbox.j?.conversations ?? []).find((c: any) => c.source === 'app');
  ok('conversation appears in admin inbox with unread', !!conv && conv.unreadStaff >= 1 && inbox.j.unread >= 1);
  const reply = await api('POST', `/api/v1/admin/comms/conversations/${conv.id}/reply`, tok, { body: 'Happy to help — go to Connected Services.' });
  ok('staff can reply', reply.status === 201);
  const userChat = await api('GET', '/api/v1/comms/chat', utok);
  ok('user sees the staff reply', (userChat.j?.messages ?? []).some((m: any) => m.role === 'staff' && /Happy to help/.test(m.body)));
  const unreadAfterOpen = await api('GET', '/api/v1/comms/chat/unread', utok);
  ok('opening the chat clears user unread', (unreadAfterOpen.j?.unread ?? 0) === 0, `→ ${unreadAfterOpen.j?.unread}`);

  // --- Website bot (public, no auth) + hand-off ---
  const botHit = await api('POST', '/api/v1/site/chat', undefined, { message: 'Is my data encrypted and secure?' });
  ok('website bot answers a known question', botHit.status === 200 && typeof botHit.j?.answer === 'string' && botHit.j.answer.length > 20 && botHit.j.matched === true, JSON.stringify(botHit.j).slice(0, 120));
  const botMiss = await api('POST', '/api/v1/site/chat', undefined, { message: 'zxqwvy foobar nonsense' });
  ok('website bot offers hand-off when unsure', botMiss.j?.matched === false && /human|team/i.test(botMiss.j?.answer ?? ''));
  const handoff = await api('POST', '/api/v1/site/chat/handoff', undefined, { name: 'Vic Visitor', email: `visitor+${Date.now()}@example.com`, message: 'Please call me about pricing.', transcript: 'Visitor: hi\nVaulmo: hello' });
  ok('website hand-off creates a conversation (201)', handoff.status === 201 && handoff.j?.ok === true);
  const webInbox = await api('GET', '/api/v1/admin/comms/conversations?source=website', tok);
  ok('website conversation lands in admin inbox', (webInbox.j?.conversations ?? []).some((c: any) => c.source === 'website' && /visitor\+/.test(c.email ?? '')));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
