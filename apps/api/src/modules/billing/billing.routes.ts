import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { plans, invoices, users } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { entitlementsFor, getSubscription, startCheckout, billingPortal, provisionPlan, setCancelAtPeriodEnd, changePlan, selfSelectPlan } from '../../lib/billing/service';
import { MODULES, effectiveModules, netAmount } from '../../lib/modules';

export const billingRouter = Router();
billingRouter.use(requireAuth, requireMfaSatisfied);

function tid(req: any): string {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have billing');
  return req.auth.tid;
}

// ---- Public (to authenticated users): available plans ----
billingRouter.get('/plans', async (_req, res) => {
  const list = await db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.sort);
  res.json({ modules: MODULES, plans: list.map((p) => ({
    key: p.key, name: p.name, amount: p.amount, currency: p.currency, interval: p.interval,
    entitlements: p.entitlements, modules: effectiveModules((p as any).modules),
    discountPercent: (p as any).discountPercent ?? 0, discountLabel: (p as any).discountLabel ?? null,
    netAmount: netAmount(p.amount, (p as any).discountPercent ?? 0),
  })) });
});

// ---- Billing page: subscription + entitlements + invoices ----
billingRouter.get('/', async (req, res) => {
  const tenantId = tid(req);
  const [sub, ent, invs] = await Promise.all([
    getSubscription(tenantId),
    entitlementsFor(tenantId),
    db.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(desc(invoices.createdAt)).limit(20),
  ]);
  res.json({ subscription: sub, entitlements: ent, invoices: invs });
});

billingRouter.get('/entitlements', async (req, res) => {
  res.json(await entitlementsFor(tid(req)));
});

// ---- Stripe Checkout ----
const checkoutSchema = z.object({ planKey: z.string().min(1), successUrl: z.string().optional(), cancelUrl: z.string().optional() });
billingRouter.post('/checkout', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const body = checkoutSchema.parse(req.body);
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  try {
    const session = await startCheckout(
      tid(req),
      u.email,
      body.planKey,
      body.successUrl ?? 'https://app.lifehub.local/billing/success',
      body.cancelUrl ?? 'https://app.lifehub.local/billing/cancel',
    );
    await audit({ action: 'billing.checkout.started', actorId: req.auth!.sub, tenantId: tid(req), metadata: { planKey: body.planKey }, req });
    res.json(session);
  } catch (e) {
    throw new AppError(400, 'checkout_failed', (e as Error).message);
  }
});

billingRouter.post('/portal', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  try {
    res.json(await billingPortal(tid(req), 'https://app.lifehub.local/billing'));
  } catch (e) {
    throw new AppError(400, 'portal_failed', (e as Error).message);
  }
});

// ---- Self-serve subscription management (SEC-09/10/12/13) ----
const friendly = (e: unknown) => {
  const m = (e as Error).message;
  if (m === 'no_active_subscription') return 'You don’t have an active subscription to change.';
  if (m === 'unknown_plan') return 'That plan is not available.';
  if (m === 'already_on_plan') return 'You’re already on that plan.';
  return m;
};

// SEC-09: cancel the renewal — keeps access until the current period ends.
billingRouter.post('/cancel', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  try {
    const sub = await setCancelAtPeriodEnd(tid(req), true);
    await audit({ action: 'billing.cancel_scheduled', actorId: req.auth!.sub, tenantId: tid(req), req });
    res.json({ subscription: sub });
  } catch (e) { throw new AppError(400, 'cancel_failed', friendly(e)); }
});

// SEC-10: resume a scheduled cancellation.
billingRouter.post('/resume', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  try {
    const sub = await setCancelAtPeriodEnd(tid(req), false);
    await audit({ action: 'billing.cancel_resumed', actorId: req.auth!.sub, tenantId: tid(req), req });
    res.json({ subscription: sub });
  } catch (e) { throw new AppError(400, 'resume_failed', friendly(e)); }
});

// Onboarding: select a plan to enter the app (free activates now; paid → checkout when
// Stripe is live, or activates directly in the fake-gateway phase).
billingRouter.post('/choose', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const { planKey } = z.object({ planKey: z.string().min(1) }).parse(req.body);
  const [u] = await db.select().from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  try {
    const r = await selfSelectPlan(tid(req), u.email, planKey, 'https://app.vaulmo.com/onboarding/return', 'https://app.vaulmo.com/onboarding/plan');
    await audit({ action: 'onboarding.plan_selected', actorId: req.auth!.sub, tenantId: tid(req), metadata: { planKey, mode: r.mode }, req });
    res.json(r);
  } catch (e) { throw new AppError(400, 'choose_failed', friendly(e)); }
});

// SEC-12/13: change plan (upgrade / downgrade).
const changeSchema = z.object({ planKey: z.string().min(1) });
billingRouter.post('/change-plan', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const body = changeSchema.parse(req.body);
  try {
    const result = await changePlan(tid(req), body.planKey);
    await audit({ action: 'billing.plan_changed', actorId: req.auth!.sub, tenantId: tid(req), metadata: { planKey: body.planKey, direction: result.direction }, req });
    res.json(result);
  } catch (e) { throw new AppError(400, 'change_failed', friendly(e)); }
});

// ---- Super Admin: plan management ----
billingRouter.get('/admin/plans', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  res.json({ plans: await db.select().from(plans).orderBy(plans.sort) });
});

// Stripe connection status — so the owner can see which mode billing is in and what still
// needs configuring before switching to live payments. Secret keys are NEVER returned.
billingRouter.get('/admin/status', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const driver = (process.env.STRIPE_DRIVER ?? 'fake').toLowerCase();
  const hasSecretKey = !!process.env.STRIPE_SECRET_KEY;
  const hasWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET;
  const secretKind = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'test' : null;
  const planRows = await db.select().from(plans);
  const provisioned = planRows.filter((p) => !!p.stripePriceId).length;
  res.json({
    driver, // 'fake' | 'stripe'
    mode: driver === 'fake' ? 'sandbox' : secretKind ?? 'unknown', // sandbox | test | live
    hasSecretKey,
    hasWebhookSecret,
    plansTotal: planRows.length,
    plansProvisioned: provisioned,
    liveReady: driver === 'stripe' && hasSecretKey && hasWebhookSecret && secretKind === 'live',
  });
});

const planSchema = z.object({
  key: z.string().min(2).max(40),
  name: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().default('gbp'),
  interval: z.string().default('year'),
  entitlements: z.record(z.any()).default({}),
  modules: z.array(z.string()).optional(),
  discountPercent: z.number().int().min(0).max(100).optional(),
  discountLabel: z.string().max(60).nullable().optional(),
  sort: z.number().int().optional(),
  active: z.boolean().optional(),
});
billingRouter.post('/admin/plans', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const body = planSchema.parse(req.body);
  const set: any = { ...body, entitlements: body.entitlements as any };
  if (body.modules !== undefined) set.modules = body.modules as any;
  const [existing] = await db.select().from(plans).where(eq(plans.key, body.key)).limit(1);
  if (existing) {
    await db.update(plans).set(set).where(eq(plans.key, body.key));
  } else {
    await db.insert(plans).values(set);
  }
  const provisioned = await provisionPlan(body.key); // creates Stripe product + price (real driver) or a fake ref
  await audit({ action: 'billing.plan.upserted', actorId: req.auth!.sub, metadata: { key: body.key }, req });
  res.status(201).json({ plan: provisioned });
});
