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
import { entitlementsFor, getSubscription, startCheckout, billingPortal, provisionPlan } from '../../lib/billing/service';

export const billingRouter = Router();
billingRouter.use(requireAuth, requireMfaSatisfied);

function tid(req: any): string {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have billing');
  return req.auth.tid;
}

// ---- Public (to authenticated users): available plans ----
billingRouter.get('/plans', async (_req, res) => {
  const list = await db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.sort);
  res.json({ plans: list.map((p) => ({ key: p.key, name: p.name, amount: p.amount, currency: p.currency, interval: p.interval, entitlements: p.entitlements })) });
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

// ---- Super Admin: plan management ----
billingRouter.get('/admin/plans', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  res.json({ plans: await db.select().from(plans).orderBy(plans.sort) });
});

const planSchema = z.object({
  key: z.string().min(2).max(40),
  name: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().default('gbp'),
  interval: z.string().default('year'),
  entitlements: z.record(z.any()).default({}),
  sort: z.number().int().optional(),
});
billingRouter.post('/admin/plans', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const body = planSchema.parse(req.body);
  const [existing] = await db.select().from(plans).where(eq(plans.key, body.key)).limit(1);
  if (existing) {
    await db.update(plans).set({ ...body, entitlements: body.entitlements as any }).where(eq(plans.key, body.key));
  } else {
    await db.insert(plans).values({ ...body, entitlements: body.entitlements as any });
  }
  const provisioned = await provisionPlan(body.key); // creates Stripe product + price
  await audit({ action: 'billing.plan.upserted', actorId: req.auth!.sub, metadata: { key: body.key }, req });
  res.status(201).json({ plan: provisioned });
});
