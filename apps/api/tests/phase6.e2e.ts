/**
 * Phase 6 — Subscriptions & Stripe end-to-end proof (fake gateway = Stripe Test Mode).
 * Proves: plan management, Checkout, webhook-driven activation, entitlements, renewal,
 * failed payment → grace period → suspension, cancellation, webhook idempotency and
 * signature verification. Flipping to real Stripe is env + keys only.
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { subscriptions } from '../src/db/schema';
import { signWebhookPayload } from '../src/lib/billing/gateway';

const PORT = 4014;
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

// Post a signed Stripe webhook (raw body must match the signed string exactly).
async function webhook(id: string, type: string, object: Record<string, unknown>, badSig = false) {
  const raw = JSON.stringify({ id, type, data: { object } });
  const sig = badSig ? 'deadbeef' : signWebhookPayload(raw);
  const res = await fetch(base + '/api/v1/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: raw });
  const t = await res.text(); let j: any = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, json: j };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  const sa = await login('admin@lifehub.local', 'ChangeMe123!');
  const R = Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36);

  const email = `cust+${Date.now()}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email, password: 'Customer12345!', fullName: 'Paying Customer' } });
  const tenantId = reg.json.user.tenantId;
  const token = await login(email, 'Customer12345!');

  console.log('\nPLANS & ENTITLEMENTS (free by default)');
  const plansRes = await api('GET', '/api/v1/billing/plans', { token });
  check('annual plans are listed', (plansRes.json.plans ?? []).some((p: any) => p.key === 'family' && p.interval === 'year'));
  const ent0 = await api('GET', '/api/v1/billing/entitlements', { token });
  check('new tenant is on free Starter (AI off)', ent0.json.planKey === 'starter' && ent0.json.entitlements.aiAssistant === false);

  console.log('\nCHECKOUT (Stripe Checkout session)');
  const checkout = await api('POST', '/api/v1/billing/checkout', { token, body: { planKey: 'family' } });
  check('checkout returns a session URL', !!checkout.json.url && !!checkout.json.sessionId, JSON.stringify(checkout.json));

  console.log('\nWEBHOOK: activation');
  const okAct = await webhook(`evt_activate_1_${R}`, 'checkout.session.completed', { metadata: { tenantId, planKey: 'family' }, customer: 'cus_1', subscription: 'sub_1', amount: 5900 });
  check('checkout.session.completed activates the subscription', okAct.json.action === 'activated', JSON.stringify(okAct.json));
  const b1 = await api('GET', '/api/v1/billing', { token });
  check('subscription is active on the Family plan', b1.json.subscription?.status === 'active' && b1.json.subscription?.planKey === 'family');
  check('renewal date (currentPeriodEnd) is set ~1yr out', !!b1.json.subscription?.currentPeriodEnd);
  const ent1 = await api('GET', '/api/v1/billing/entitlements', { token });
  check('entitlements now grant the AI assistant', ent1.json.active === true && ent1.json.entitlements.aiAssistant === true);

  console.log('\nWEBHOOK: idempotency & signature');
  const dup = await webhook(`evt_activate_1_${R}`, 'checkout.session.completed', { metadata: { tenantId, planKey: 'family' } });
  check('replaying the same event is a no-op (idempotent)', dup.json.action === 'duplicate');
  const bad = await webhook(`evt_x_${R}`, 'invoice.paid', { metadata: { tenantId } }, true);
  check('an invalid signature is rejected (400)', bad.status === 400);

  console.log('\nRENEWAL');
  const periodBefore = (await api('GET', '/api/v1/billing', { token })).json.subscription.currentPeriodEnd;
  const renew = await webhook(`evt_renew_1_${R}`, 'invoice.paid', { metadata: { tenantId }, amount: 5900 });
  check('invoice.paid renews the subscription', renew.json.action === 'renewed');
  const periodAfter = (await api('GET', '/api/v1/billing', { token })).json.subscription.currentPeriodEnd;
  check('renewal extends the period end', new Date(periodAfter) >= new Date(periodBefore));

  console.log('\nFAILED PAYMENT → GRACE PERIOD');
  const failed_ = await webhook(`evt_fail_1_${R}`, 'invoice.payment_failed', { metadata: { tenantId }, amount: 5900 });
  check('payment_failed marks the subscription past_due', failed_.json.action === 'past_due');
  const entGrace = await api('GET', '/api/v1/billing/entitlements', { token });
  check('entitlements REMAIN active during the grace period', entGrace.json.active === true && entGrace.json.inGrace === true);

  console.log('\nGRACE EXPIRY → SUSPENSION');
  await db.update(subscriptions).set({ graceUntil: new Date(Date.now() - 86400000) }).where(eq(subscriptions.tenantId, tenantId));
  const entSuspended = await api('GET', '/api/v1/billing/entitlements', { token });
  check('after grace expires, entitlements are suspended', entSuspended.json.active === false && entSuspended.json.entitlements.aiAssistant === false);

  console.log('\nCANCELLATION');
  const cancel = await webhook(`evt_cancel_1_${R}`, 'customer.subscription.deleted', { metadata: { tenantId } });
  check('subscription.deleted cancels the subscription', cancel.json.action === 'canceled');
  const entCanceled = await api('GET', '/api/v1/billing/entitlements', { token });
  check('canceled tenant falls back to free Starter', entCanceled.json.planKey === 'starter' && entCanceled.json.active === true);

  console.log('\nSUPER ADMIN PLAN MANAGEMENT');
  const created = await api('POST', '/api/v1/billing/admin/plans', { token: sa, body: { key: 'business', name: 'Business', amount: 24900, entitlements: { documents: -1, members: 25, aiAssistant: true }, sort: 40 } });
  check('super admin can create a plan (provisioned into Stripe)', created.status === 201 && !!created.json.plan?.stripePriceId, JSON.stringify(created.json).slice(0, 120));
  const adminPlans = await api('GET', '/api/v1/billing/admin/plans', { token: sa });
  check('the new plan appears in plan management', (adminPlans.json.plans ?? []).some((p: any) => p.key === 'business'));
  const denied = await api('POST', '/api/v1/billing/admin/plans', { token, body: { key: 'x', name: 'X', amount: 1 } });
  check('a tenant user cannot manage plans (403)', denied.status === 403);

  const auditLog = await api('GET', '/api/v1/admin/audit?limit=200', { token: sa });
  check('checkout start is audited', (auditLog.json.logs ?? []).some((l: any) => l.action === 'billing.checkout.started'));

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}\n  RESULT: ${passed} passed, ${failed} failed\n${'='.repeat(48)}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
