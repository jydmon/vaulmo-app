import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { subscriptions, plans, tenants, invoices, stripeEvents } from '../../db/schema';
import { getGateway, type StripeEvent } from './gateway';
import { effectiveModules } from '../modules';

const GRACE_DAYS = 14;
const gateway = getGateway();

export async function getPlan(key: string) {
  const [p] = await db.select().from(plans).where(eq(plans.key, key)).limit(1);
  return p;
}

async function upsertSubscription(tenantId: string, patch: Partial<typeof subscriptions.$inferInsert>) {
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  if (existing) {
    const [row] = await db.update(subscriptions).set({ ...patch, updatedAt: new Date() }).where(eq(subscriptions.tenantId, tenantId)).returning();
    return row;
  }
  const [row] = await db.insert(subscriptions).values({ tenantId, ...patch }).returning();
  return row;
}

export async function getSubscription(tenantId: string) {
  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  return s ?? null;
}

// SEC-09/10: self-serve cancel / resume. Cancelling schedules the subscription to
// end at the current period end — access is KEPT until then (never an immediate cut).
// Resuming clears the scheduled cancellation.
export async function setCancelAtPeriodEnd(tenantId: string, cancel: boolean) {
  const sub = await getSubscription(tenantId);
  if (!sub || !['active', 'trialing', 'past_due'].includes(sub.status)) throw new Error('no_active_subscription');
  await upsertSubscription(tenantId, { cancelAtPeriodEnd: cancel });
  return getSubscription(tenantId);
}

// Onboarding plan gate: the user selects a plan before entering the app. Free plans
// activate immediately; paid plans go to Stripe Checkout when live, or (in the
// fake-gateway phase) activate directly so the onboarding journey completes end-to-end.
export async function selfSelectPlan(tenantId: string, email: string, planKey: string, successUrl: string, cancelUrl: string) {
  const plan = await getPlan(planKey);
  if (!plan) throw new Error('unknown_plan');
  const isFree = (plan.amount ?? 0) === 0;
  const gatewayLive = (process.env.STRIPE_DRIVER ?? 'fake') === 'stripe';
  if (!isFree && gatewayLive) {
    const session = await startCheckout(tenantId, email, planKey, successUrl, cancelUrl);
    return { mode: 'checkout' as const, url: session.url };
  }
  const end = new Date(); end.setMonth(end.getMonth() + 12);
  await upsertSubscription(tenantId, { planKey, status: 'active', currentPeriodEnd: isFree ? null : end, graceUntil: null, cancelAtPeriodEnd: false });
  await db.update(tenants).set({ plan: planKey }).where(eq(tenants.id, tenantId));
  return { mode: 'activated' as const, subscription: await getSubscription(tenantId) };
}

// SEC-12/13: self-serve plan change. In this (fake-gateway) phase the change applies
// immediately and keeps the current period end; when Stripe is live the gateway
// prorates. Returns the direction so the UI can message upgrade vs downgrade.
export async function changePlan(tenantId: string, planKey: string) {
  const plan = await getPlan(planKey);
  if (!plan) throw new Error('unknown_plan');
  const sub = await getSubscription(tenantId);
  if (!sub || !['active', 'trialing'].includes(sub.status)) throw new Error('no_active_subscription');
  if (sub.planKey === planKey) throw new Error('already_on_plan');
  const current = sub.planKey ? await getPlan(sub.planKey) : null;
  const direction = current && (plan.amount ?? 0) < (current.amount ?? 0) ? 'downgrade' : 'upgrade';
  await upsertSubscription(tenantId, { planKey, cancelAtPeriodEnd: false });
  await db.update(tenants).set({ plan: planKey }).where(eq(tenants.id, tenantId));
  return { subscription: await getSubscription(tenantId), direction };
}

// Super-admin-managed subscription. LifeHub/Vaulmo sells annual plans that the platform
// owner administers directly (grant, extend, cancel) — this is that control, independent of
// the Stripe checkout flow. Keeps subscriptions + tenants.plan in sync.
export async function adminSetSubscription(
  tenantId: string,
  opts: { planKey: string; status?: string; months?: number },
) {
  const plan = await getPlan(opts.planKey);
  if (!plan) throw new Error('unknown_plan');
  const status = opts.status ?? 'active';
  const months = opts.months ?? 12;

  let currentPeriodEnd: Date | null = null;
  if (status === 'active' || status === 'trialing') {
    const end = new Date();
    end.setMonth(end.getMonth() + months);
    currentPeriodEnd = end;
  }
  await upsertSubscription(tenantId, {
    planKey: opts.planKey,
    status,
    currentPeriodEnd,
    graceUntil: null,
    cancelAtPeriodEnd: false,
  });
  // A cancel/none drops the tenant back to the free (starter) plan display.
  const planForTenant = status === 'canceled' || status === 'none' ? 'starter' : opts.planKey;
  await db.update(tenants).set({ plan: planForTenant }).where(eq(tenants.id, tenantId));
  return getSubscription(tenantId);
}

// Entitlements = what the tenant is allowed to use right now. A past_due subscription
// keeps its entitlements THROUGH the grace period, then loses them (suspended).
export async function entitlementsFor(tenantId: string, now = new Date()) {
  const sub = await getSubscription(tenantId);
  const freePlan = await getPlan('starter');

  if (!sub || sub.status === 'none' || sub.status === 'canceled') {
    return { planKey: 'starter', status: sub?.status ?? 'none', active: true, inGrace: false, entitlements: (freePlan?.entitlements as any) ?? {}, modules: effectiveModules(freePlan?.modules), currentPeriodEnd: null, graceUntil: null };
  }
  const inGrace = sub.status === 'past_due' && !!sub.graceUntil && sub.graceUntil.getTime() > now.getTime();
  const active = sub.status === 'active' || sub.status === 'trialing' || inGrace;
  const plan = sub.planKey ? await getPlan(sub.planKey) : null;
  const entitlements = active && plan ? (plan.entitlements as any) : (freePlan?.entitlements as any) ?? {};
  const modules = effectiveModules((active && plan ? plan.modules : freePlan?.modules));
  return { planKey: sub.planKey, status: sub.status, active, inGrace, entitlements, modules, currentPeriodEnd: sub.currentPeriodEnd, graceUntil: sub.graceUntil };
}

export async function startCheckout(tenantId: string, email: string, planKey: string, successUrl: string, cancelUrl: string) {
  const plan = await getPlan(planKey);
  if (!plan) throw new Error('unknown_plan');
  if (!plan.stripePriceId) throw new Error('plan_not_provisioned'); // Stripe product/price must exist

  const customerId = await gateway.ensureCustomer(tenantId, email);
  await upsertSubscription(tenantId, { stripeCustomerId: customerId, status: (await getSubscription(tenantId))?.status ?? 'incomplete', planKey });
  const session = await gateway.createCheckoutSession({ customerId, priceId: plan.stripePriceId, tenantId, planKey, successUrl, cancelUrl });
  return session;
}

export async function billingPortal(tenantId: string, returnUrl: string) {
  const sub = await getSubscription(tenantId);
  if (!sub?.stripeCustomerId) throw new Error('no_customer');
  return gateway.createBillingPortal(sub.stripeCustomerId, returnUrl);
}

// Provision a plan into Stripe (create product + price) and store the ids.
export async function provisionPlan(planKey: string) {
  const plan = await getPlan(planKey);
  if (!plan) throw new Error('unknown_plan');
  const { productId, priceId } = await gateway.createProductPrice({ key: plan.key, name: plan.name, amount: plan.amount, currency: plan.currency, interval: plan.interval });
  const [row] = await db.update(plans).set({ stripeProductId: productId, stripePriceId: priceId }).where(eq(plans.key, plan.key)).returning();
  return row;
}

function oneYearFrom(base: Date): Date {
  const d = new Date(base);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

export function parseEvent(rawBody: Buffer, signature: string): StripeEvent {
  return gateway.verifyAndParseEvent(rawBody, signature);
}

// Idempotent webhook processing. Returns the action taken (or 'duplicate').
export async function handleEvent(event: StripeEvent, now = new Date()): Promise<string> {
  const inserted = await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning();
  if (!inserted.length) return 'duplicate';

  const d = event.data?.object ?? event.data ?? {};
  const tenantId: string | undefined = d.tenantId ?? d.metadata?.tenantId;

  switch (event.type) {
    case 'checkout.session.completed': {
      await upsertSubscription(tenantId!, {
        planKey: d.planKey ?? d.metadata?.planKey,
        status: 'active',
        stripeCustomerId: d.customerId ?? d.customer,
        stripeSubscriptionId: d.subscriptionId ?? d.subscription,
        currentPeriodEnd: oneYearFrom(now),
        graceUntil: null,
        cancelAtPeriodEnd: false,
      });
      if (tenantId) await db.update(tenants).set({ plan: d.planKey ?? d.metadata?.planKey }).where(eq(tenants.id, tenantId));
      await db.insert(invoices).values({ tenantId, stripeInvoiceId: d.invoiceId ?? null, amount: d.amount ?? 0, status: 'paid' });
      return 'activated';
    }
    case 'invoice.paid': {
      await upsertSubscription(tenantId!, { status: 'active', currentPeriodEnd: oneYearFrom(now), graceUntil: null });
      await db.insert(invoices).values({ tenantId, stripeInvoiceId: d.invoiceId ?? null, amount: d.amount ?? 0, status: 'paid' });
      return 'renewed';
    }
    case 'invoice.payment_failed': {
      const graceUntil = new Date(now.getTime() + GRACE_DAYS * 86400000);
      await upsertSubscription(tenantId!, { status: 'past_due', graceUntil });
      await db.insert(invoices).values({ tenantId, stripeInvoiceId: d.invoiceId ?? null, amount: d.amount ?? 0, status: 'failed' });
      return 'past_due';
    }
    case 'customer.subscription.deleted': {
      await upsertSubscription(tenantId!, { status: 'canceled', cancelAtPeriodEnd: false });
      if (tenantId) await db.update(tenants).set({ plan: 'starter' }).where(eq(tenants.id, tenantId));
      return 'canceled';
    }
    default:
      return 'ignored';
  }
}
