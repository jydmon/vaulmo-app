/**
 * Phases 9–13 end-to-end proof.
 * 9  Integration Gateway: OAuth connect, ENCRYPTED token storage, connections, sync, webhook, provenance.
 * 10 Email: classification + travel/ticket/purchase/warranty/subscription detection + user confirmation.
 * 11 Trips: email-to-trip matching (flight + hotel group into one trip) + travel reminders.
 * 12 Purchases & Warranties: purchase/asset creation + warranty reminders.
 * 13 Subscription tracking: tracked subscription + renewal reminder.
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users, connections, auditLogs } from '../src/db/schema';
import { decrypt } from '../src/lib/crypto';

const PORT = 4016;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d && '— ' + d}`)); };
async function api(method: string, url: string, o: { body?: unknown; token?: string } = {}) {
  const h: Record<string, string> = {};
  if (o.token) h.authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: res.status, json: j };
}
const login = async (e: string, p: string) => (await api('POST', '/api/v1/auth/login', { body: { email: e, password: p } })).json?.accessToken;

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  const sa = await login('admin@lifehub.local', 'ChangeMe123!');

  const email = `int+${Date.now()}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'Integr12345!', fullName: 'Integrator' } });
  await db.update(users).set({ isInternalTester: true }).where(eq(users.id, reg.json.user.id));
  const token = await login(email, 'Integr12345!');

  console.log('\nPHASE 9 — CONNECT (OAuth) + ENCRYPTED TOKENS');
  const providers = await api('GET', '/api/v1/integrations/providers', { token });
  check('gmail & outlook providers are available', ['gmail', 'outlook'].every((k) => providers.json.providers.some((p: any) => p.key === k)));
  const connectStart = await api('POST', '/api/v1/integrations/gmail/connect', { token });
  check('OAuth start returns a consent URL', !!connectStart.json.authUrl);
  const cb = await api('POST', '/api/v1/integrations/gmail/callback', { token, body: { code: 'authcode123' } });
  const connId = cb.json.connection.id;
  check('callback creates a connection', cb.status === 201 && cb.json.connection.provider === 'gmail');
  check('tokens are NOT returned by the API', !('accessTokenEnc' in cb.json.connection) && !('accessToken' in cb.json.connection));
  const [dbConn] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
  check('access token is stored ENCRYPTED (not plaintext)', !!dbConn.accessTokenEnc && !dbConn.accessTokenEnc!.includes('at_gmail'));
  check('encrypted token decrypts back to the original', decrypt(dbConn.accessTokenEnc!) === 'at_gmail_authcode123');

  console.log('\nPHASE 10 — SYNC + CLASSIFY + DETECT');
  const sync = await api('POST', `/api/v1/integrations/connections/${connId}/sync`, { token });
  check('sync creates detected items', sync.json.created >= 4, JSON.stringify(sync.json));
  check('classified travel, purchase, ticket & subscription', ['travel', 'purchase', 'ticket', 'subscription'].every((t) => (sync.json.byType[t] ?? 0) >= 1));
  const detected = await api('GET', '/api/v1/integrations/detected', { token });
  const items = detected.json.detected;
  check('detected items carry provenance (connection id)', items.every((i: any) => i.connectionId === connId));

  console.log('\nPHASE 11 — EMAIL → TRIP (matching)');
  const flight = items.find((i: any) => i.type === 'travel' && i.extracted.kind === 'flight');
  const hotel = items.find((i: any) => i.type === 'travel' && i.extracted.kind === 'hotel');
  const cf = await api('POST', `/api/v1/inbox/detected/${flight.id}/confirm`, { token });
  check('confirming a flight creates a trip', cf.json.entityType === 'trip');
  const ch = await api('POST', `/api/v1/inbox/detected/${hotel.id}/confirm`, { token });
  check('confirming the hotel matches the SAME trip', ch.json.entityId === cf.json.entityId, `${cf.json.entityId} vs ${ch.json.entityId}`);
  const tripsRes = await api('GET', '/api/v1/trips', { token });
  const trip = tripsRes.json.trips.find((t: any) => t.id === cf.json.entityId);
  check('the trip has both flight and hotel items', trip.items.length === 2 && trip.items.some((i: any) => i.kind === 'flight') && trip.items.some((i: any) => i.kind === 'hotel'));

  console.log('\nPHASE 12 — EMAIL → PURCHASE + WARRANTY');
  const purchase = items.find((i: any) => i.type === 'purchase');
  const cp = await api('POST', `/api/v1/inbox/detected/${purchase.id}/confirm`, { token });
  check('confirming a receipt creates a purchase', cp.json.entityType === 'purchase');
  const purchases = await api('GET', '/api/v1/purchases', { token });
  const p = purchases.json.purchases.find((x: any) => x.id === cp.json.entityId);
  check('purchase is tracked as an asset with a warranty date', p.isAsset === true && !!p.warrantyExpiry);

  console.log('\nPHASE 13 — EMAIL → TRACKED SUBSCRIPTION');
  const sub = items.find((i: any) => i.type === 'subscription');
  const cs = await api('POST', `/api/v1/inbox/detected/${sub.id}/confirm`, { token });
  check('confirming a membership email creates a tracked subscription', cs.json.entityType === 'subscription');
  const subs = await api('GET', '/api/v1/tracked-subscriptions', { token });
  check('the subscription (e.g. Netflix) is tracked', (subs.json.subscriptions ?? []).length >= 1);

  console.log('\nREMINDERS FROM CONFIRMED ITEMS');
  const rem = await api('GET', '/api/v1/vault/reminders', { token });
  const titles = (rem.json.live ?? []).map((r: any) => r.title);
  check('a warranty reminder went live', titles.some((t: string) => /warranty/i.test(t)));
  check('a subscription renewal reminder went live', titles.some((t: string) => /renews/i.test(t)));

  console.log('\nDISMISS, WEBHOOK, DISCONNECT, GATE');
  const ticket = items.find((i: any) => i.type === 'ticket');
  await api('POST', `/api/v1/integrations/detected/${ticket.id}/dismiss`, { token });
  const pendingAfter = await api('GET', '/api/v1/integrations/detected', { token });
  check('a detected item can be dismissed', !pendingAfter.json.detected.some((i: any) => i.id === ticket.id));
  const wh = await api('POST', '/api/v1/integrations-webhook/gmail', { body: { hello: 'world' } });
  check('the webhook framework accepts provider callbacks', wh.json.received === true);
  await api('DELETE', `/api/v1/integrations/connections/${connId}`, { token });
  const [afterDisc] = await db.select().from(connections).where(eq(connections.id, connId)).limit(1);
  check('disconnect clears the stored tokens', afterDisc.status === 'disconnected' && afterDisc.accessTokenEnc === null);

  const outEmail = `out+${Date.now()}@x.com`;
  await api('POST', '/api/v1/auth/register', { body: { email: outEmail, password: 'Outsider12345!', fullName: 'Out' } });
  const outsider = await login(outEmail, 'Outsider12345!');
  const denied = await api('GET', '/api/v1/integrations/connections', { token: outsider });
  check('non-pilot user cannot access integrations (403)', denied.status === 403);

  const auditRows = await db.select().from(auditLogs);
  const actions = auditRows.map((l) => l.action);
  check('connect, sync and confirm are audited (provenance)', ['integration.connected', 'integration.synced', 'inbox.confirmed'].every((a) => actions.includes(a)));

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}\n  RESULT: ${passed} passed, ${failed} failed\n${'='.repeat(48)}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
