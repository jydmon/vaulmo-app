/**
 * Renewals & Expiries hub smoke test (AIX-11, INT-18/19/21, SEC-06).
 *
 * Proves the unified horizon aggregates subscription renewals and asset (MOT)
 * renewals, buckets them by urgency, honours the withinDays window, and that the
 * assistant answers natural-language horizon questions from the same data.
 */
import { createApp } from '../src/app';
import { pool } from '../src/db/client';

const PORT = 4104; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
const isoInDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  const email = `exp+${Date.now()}@example.com`; const password = 'ExpUser123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Exp User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const tok = login.j?.accessToken;
  ok('login', !!tok);

  // A subscription renewing in 20 days → ACTIVE reminder, category Subscription.
  const sub = await api('POST', '/api/v1/tracked-subscriptions', tok, { name: 'Netflix', cycle: 'monthly', amount: '9.99', renewalDate: isoInDays(20) });
  ok('subscription created', sub.status === 201 || sub.status === 200, `→ ${sub.status}`);

  // A vehicle with an MOT due in 60 days → asset_renewal reminder, category Vehicle.
  const asset = await api('POST', '/api/v1/assets', tok, { kind: 'vehicle', name: 'My Car', details: { motDate: isoInDays(60) } });
  ok('vehicle asset created', asset.status === 201 || asset.status === 200, `→ ${asset.status}`);

  // Full horizon (1 year): both items present, correctly categorised and bucketed.
  const year = await api('GET', '/api/v1/vault/expiries?withinDays=365', tok);
  const items = year.j?.items ?? [];
  const netflix = items.find((i: any) => /netflix/i.test(i.title));
  const car = items.find((i: any) => /my car/i.test(i.title));
  ok('horizon returns the subscription renewal', !!netflix && netflix.category === 'Subscription', JSON.stringify(netflix));
  ok('horizon returns the vehicle MOT renewal', !!car && car.category === 'Vehicle', JSON.stringify(car));
  ok('subscription lands in the "soon" bucket (≤30d)', (year.j?.buckets?.soon ?? []).some((i: any) => /netflix/i.test(i.title)));
  ok('MOT lands in the "upcoming" bucket (31–90d)', (year.j?.buckets?.upcoming ?? []).some((i: any) => /my car/i.test(i.title)));
  ok('items are sorted soonest-first', items.length >= 2 && items[0].dueDate <= items[1].dueDate);
  ok('daysRemaining computed (subscription ~20d)', netflix && netflix.daysRemaining >= 18 && netflix.daysRemaining <= 22, `→ ${netflix?.daysRemaining}`);

  // Narrow window (30 days): the 60-day MOT drops out, the 20-day sub stays.
  const short = await api('GET', '/api/v1/vault/expiries?withinDays=30', tok);
  const sItems = short.j?.items ?? [];
  ok('30-day window keeps the subscription', sItems.some((i: any) => /netflix/i.test(i.title)));
  ok('30-day window excludes the 60-day MOT', !sItems.some((i: any) => /my car/i.test(i.title)));

  // Assistant horizon queries (AIX-11).
  const ask12 = await api('POST', '/api/v1/assistant/ask', tok, { question: 'what expires in the next 12 months?' });
  ok('assistant "12 months" lists both items', /netflix/i.test(ask12.j?.answer ?? '') && /my car/i.test(ask12.j?.answer ?? ''), (ask12.j?.answer ?? '').slice(0, 120));
  const ask30 = await api('POST', '/api/v1/assistant/ask', tok, { question: "what's due in the next 30 days?" });
  ok('assistant "30 days" includes the subscription', /netflix/i.test(ask30.j?.answer ?? ''));
  ok('assistant "30 days" excludes the 60-day MOT', !/my car/i.test(ask30.j?.answer ?? ''), (ask30.j?.answer ?? '').slice(0, 120));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
