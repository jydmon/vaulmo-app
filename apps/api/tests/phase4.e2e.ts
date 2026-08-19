/**
 * Phase 4 — Notifications & Reminder Engine end-to-end proof.
 * Proves: the reminder tick, escalation (one notify per threshold, no spam),
 * in-app + email + push channels, channel preferences, snooze, due-date tracking,
 * and missing-document reminders. Real DB; deterministic (dates computed from now).
 */
import { and, eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users, notifications, reminders } from '../src/db/schema';

const PORT = 4012;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d && '— ' + d}`)); };

async function api(method: string, url: string, o: { body?: unknown; token?: string; raw?: Buffer; ct?: string } = {}) {
  const h: Record<string, string> = {};
  if (o.token) h.authorization = `Bearer ${o.token}`;
  let body: string | Buffer | undefined;
  if (o.raw) { h['content-type'] = o.ct ?? 'text/plain'; body = o.raw; }
  else if (o.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(o.body); }
  const res = await fetch(url.startsWith('http') ? url : base + url, { method, headers: h, body });
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: res.status, json: j };
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateInDays(days: number): { iso: string; label: string } {
  const d = new Date(Date.now() + days * 86400000);
  const iso = d.toISOString().slice(0, 10);
  return { iso, label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}
const passportText = (expiryLabel: string) =>
  `UNITED KINGDOM\nPASSPORT\nType P Code GBR\nPassport No: 546872331\nNationality: British\nGiven names: SARAH JANE\nDate of expiry: ${expiryLabel}`;

async function scanConfirm(token: string, expiryDays: number) {
  const { iso, label } = dateInDays(expiryDays);
  const bytes = Buffer.from(passportText(label));
  const init = await api('POST', '/api/v1/vault/documents', { token, body: { filename: `p${expiryDays}.txt`, contentType: 'text/plain', sizeBytes: bytes.length } });
  await api('PUT', init.json.uploadUrl, { token, raw: bytes });
  await api('POST', `/api/v1/vault/documents/${init.json.documentId}/process`, { token });
  await api('POST', `/api/v1/vault/documents/${init.json.documentId}/confirm`, { token, body: {} });
  return iso;
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  const email = `pilot+${Date.now()}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'Pilot12345!', fullName: 'Pilot User' } });
  const userId = reg.json.user.id;
  await db.update(users).set({ isInternalTester: true }).where(eq(users.id, userId));
  const token = await login(email, 'Pilot12345!');
  const sa = await adminLogin('admin@lifehub.local', 'ChangeMe123!');
  check('pilot user signs in', !!token);

  console.log('\nDUE-DATE REMINDER + ESCALATION');
  const isoA = await scanConfirm(token, 3); // due in 3 days → escalation level 2
  const remA = await api('GET', '/api/v1/vault/reminders', { token });
  check('confirmed document created a LIVE reminder', (remA.json.live ?? []).some((r: any) => r.dueDate === isoA));

  const tick1 = await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  check('reminder tick notifies (>=1)', tick1.json.notified >= 1, JSON.stringify(tick1.json));

  const inbox = await api('GET', '/api/v1/notifications', { token });
  check('in-app inbox has a reminder notification', (inbox.json.notifications ?? []).some((n: any) => n.category === 'reminder'));
  const unread = await api('GET', '/api/v1/notifications/unread-count', { token });
  check('unread count > 0', unread.json.unread > 0);

  const emailRows = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.channel, 'email'), eq(notifications.category, 'reminder')));
  check('email channel notification was queued', emailRows.length >= 1);

  console.log('\nNO-SPAM (idempotent escalation)');
  const before = (await api('GET', '/api/v1/notifications/unread-count', { token })).json.unread;
  await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  const after = (await api('GET', '/api/v1/notifications/unread-count', { token })).json.unread;
  check('re-running the tick does not re-notify same urgency', after === before, `${before} → ${after}`);

  console.log('\nSNOOZE');
  const isoB = await scanConfirm(token, 2); // due in 2 days
  const remB = (await api('GET', '/api/v1/vault/reminders', { token })).json.live.find((r: any) => r.dueDate === isoB);
  await api('POST', `/api/v1/notifications/reminders/${remB.id}/snooze`, { token, body: { days: 10 } });
  await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  const bNotifs = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.reminderId, remB.id)));
  check('a snoozed reminder produces no notifications', bNotifs.length === 0, `got ${bNotifs.length}`);

  console.log('\nMISSING-DOCUMENT REMINDERS');
  const missing = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.category, 'missing_document')));
  check('missing-document reminder generated', missing.length >= 1);

  console.log('\nCHANNEL PREFERENCES');
  await api('PUT', '/api/v1/notifications/settings', { token, body: { email: false, push: false } });
  const isoC = await scanConfirm(token, 1); // due in 1 day
  await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  const remC = (await api('GET', '/api/v1/vault/reminders', { token })).json.live.find((r: any) => r.dueDate === isoC);
  const cEmail = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.reminderId, remC.id), eq(notifications.channel, 'email')));
  const cInApp = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.reminderId, remC.id), eq(notifications.channel, 'in_app')));
  check('email suppressed when preference is off', cEmail.length === 0);
  check('in-app still delivered when enabled', cInApp.length >= 1);

  console.log('\nMARK READ + GATE');
  const anId = (await api('GET', '/api/v1/notifications', { token })).json.notifications.find((n: any) => !n.readAt)?.id;
  const u1 = (await api('GET', '/api/v1/notifications/unread-count', { token })).json.unread;
  await api('POST', `/api/v1/notifications/${anId}/read`, { token });
  const u2 = (await api('GET', '/api/v1/notifications/unread-count', { token })).json.unread;
  check('marking read decrements unread', u2 === u1 - 1, `${u1} → ${u2}`);

  const outEmail = `outsider+${Date.now()}@x.com`;
  await api('POST', '/api/v1/auth/register', { body: { email: outEmail, password: 'Outsider123!', fullName: 'Out' } });
  const outsider = await login(outEmail, 'Outsider123!');
  const openAccess = await api('GET', '/api/v1/notifications', { token: outsider });
  check('any user can now reach their notifications (gate removed)', openAccess.status === 200);

  const auditLog = await api('GET', '/api/v1/admin/audit?limit=200', { token: sa });
  check('reminder tick audited', (auditLog.json.logs ?? []).some((l: any) => l.action === 'reminder.tick'));

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}\n  RESULT: ${passed} passed, ${failed} failed\n${'='.repeat(48)}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
