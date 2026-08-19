/**
 * Reminders & Notifications user-phase smoke test.
 * Proves: custom reminders, recurrence roll-forward on complete, the grouped centre
 * view, quiet-hours suppression of email/push (in-app kept), and that overdue alerts
 * are critical and bypass quiet hours.
 */
import { and, eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users, notifications, reminders } from '../src/db/schema';

const PORT = 4022;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d}`)); };

async function api(method: string, url: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const login = async (e: string, p: string) => (await api('POST', '/api/v1/auth/login', { body: { email: e, password: p } })).json?.accessToken;
async function adminLogin(e: string, p: string): Promise<string> {
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.email, e.toLowerCase()));
  const r = await api('POST', '/api/v1/auth/login', { body: { email: e, password: p } });
  const token = r.json?.accessToken;
  const en = await api('POST', '/api/v1/mfa/enroll', { token });
  const cf = await api('POST', '/api/v1/mfa/confirm', { token, body: { code: authenticator.generate(en.json.secret) } });
  return cf.json?.accessToken ?? token;
}
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  const sa = await adminLogin('admin@lifehub.local', 'ChangeMe123!');

  const email = `rem+${Date.now()}@example.com`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'RemNotif123!', fullName: 'Rem User' } });
  const userId = reg.json?.user?.id;
  const token = await login(email, 'RemNotif123!');

  // --- REM-03 custom reminder ---
  const created = await api('POST', '/api/v1/notifications/reminders', { token, body: { title: 'Renew gym membership', dueDate: iso(5), leadDays: [7, 1, 0] } });
  check('custom reminder created (ACTIVE)', created.json?.reminder?.status === 'ACTIVE' && created.json?.reminder?.source === 'user');

  // --- centre view groups it under upcoming ---
  const centre = await api('GET', '/api/v1/notifications/reminders', { token });
  check('centre view lists it under upcoming', (centre.json?.upcoming ?? []).some((r: any) => r.id === created.json.reminder.id));

  // --- REM-04 recurrence: complete a monthly reminder → next occurrence ---
  const rec = await api('POST', '/api/v1/notifications/reminders', { token, body: { title: 'Monthly water filter', dueDate: iso(2), recurrence: 'monthly' } });
  const done = await api('POST', `/api/v1/notifications/reminders/${rec.json.reminder.id}/complete`, { token });
  check('completing a recurring reminder returns COMPLETED', done.json?.status === 'COMPLETED');
  check('a next monthly occurrence is created ~1 month later', !!done.json?.nextOccurrence && done.json.nextOccurrence.dueDate > iso(20), done.json?.nextOccurrence?.dueDate);
  const centre2 = await api('GET', '/api/v1/notifications/reminders', { token });
  check('completed reminder shows under completed', (centre2.json?.completed ?? []).some((r: any) => r.id === rec.json.reminder.id));

  // --- REM-12 quiet hours: non-critical email/push suppressed, in-app kept ---
  const h = new Date().getUTCHours();
  await api('PUT', '/api/v1/notifications/settings', { token, body: { quietStart: h, quietEnd: (h + 1) % 24 } });
  // A reminder due in 5 days with lead 7 → threshold crossed, non-critical (d>0).
  const quietRem = await api('POST', '/api/v1/notifications/reminders', { token, body: { title: 'Non-critical quiet test', dueDate: iso(5), leadDays: [7] } });
  await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  const chans = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.reminderId, quietRem.json.reminder.id)));
  const kinds = new Set(chans.map((c) => c.channel));
  check('during quiet hours the in-app notification is kept', kinds.has('in_app'));
  check('during quiet hours email & push are suppressed', !kinds.has('email') && !kinds.has('push'), [...kinds].join(','));

  // --- overdue is critical → bypasses quiet hours ---
  const overdue = await api('POST', '/api/v1/notifications/reminders', { token, body: { title: 'Overdue critical test', dueDate: iso(-1), leadDays: [7, 1, 0] } });
  await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  const oChans = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.reminderId, overdue.json.reminder.id)));
  const oKinds = new Set(oChans.map((c) => c.channel));
  check('overdue (critical) reaches email/push despite quiet hours', oKinds.has('email') || oKinds.has('push'), [...oKinds].join(','));

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed\n`);
  server.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
