/**
 * Billing self-service smoke test — SEC-07/09/10/12/13.
 * Seeds an active subscription, then exercises cancel / resume / change-plan and
 * confirms access is preserved on cancel (never an immediate cut).
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { subscriptions, tenants } from '../src/db/schema';
const PORT = 4077; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));
  const email = `bl+${Date.now()}@example.com`; const password = 'Billing123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Bill User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const tok = login.j?.accessToken; const tenantId = login.j?.user?.tenantId as string; ok('login', !!tok);

  // Seed an active annual subscription on the 'family' plan.
  const periodEnd = new Date(Date.now() + 300 * 86400000);
  await db.insert(subscriptions).values({ tenantId, planKey: 'family', status: 'active', currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false });
  await db.update(tenants).set({ plan: 'family' }).where(eq(tenants.id, tenantId));

  // SEC-07: billing page returns subscription + invoices array.
  const bill = await api('GET', '/api/v1/billing', tok);
  ok('billing shows active family subscription', bill.j?.subscription?.planKey === 'family' && bill.j?.subscription?.status === 'active');
  ok('billing returns an invoices array', Array.isArray(bill.j?.invoices));

  // SEC-09: cancel — access is KEPT (status stays active, flag set).
  const cancel = await api('POST', '/api/v1/billing/cancel', tok, {});
  ok('cancel schedules end-of-period', cancel.j?.subscription?.cancelAtPeriodEnd === true, JSON.stringify(cancel.j?.subscription));
  ok('cancel does NOT cut access immediately', cancel.j?.subscription?.status === 'active');
  const entAfterCancel = await api('GET', '/api/v1/billing/entitlements', tok);
  ok('entitlements still active after cancel', entAfterCancel.j?.active === true);

  // SEC-10: resume.
  const resume = await api('POST', '/api/v1/billing/resume', tok, {});
  ok('resume clears the scheduled cancellation', resume.j?.subscription?.cancelAtPeriodEnd === false);

  // SEC-12: upgrade family → premium.
  const up = await api('POST', '/api/v1/billing/change-plan', tok, { planKey: 'premium' });
  ok('upgrade to premium', up.j?.subscription?.planKey === 'premium' && up.j?.direction === 'upgrade', JSON.stringify(up.j));

  // SEC-13: downgrade premium → family.
  const down = await api('POST', '/api/v1/billing/change-plan', tok, { planKey: 'family' });
  ok('downgrade to family', down.j?.subscription?.planKey === 'family' && down.j?.direction === 'downgrade');

  // Guard: changing to the current plan is rejected.
  const same = await api('POST', '/api/v1/billing/change-plan', tok, { planKey: 'family' });
  ok('rejects change to current plan', same.status === 400);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
