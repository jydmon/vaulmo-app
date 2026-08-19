import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { trips, tripItems, purchases, trackedSubscriptions, detectedItems, reminders } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';

export const lifeRouter = Router();
lifeRouter.use(requireAuth, requireMfaSatisfied);
const tid = (req: any): string => {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have this');
  return req.auth.tid;
};

// A confirmed entity's reminders go live immediately (the user confirming IS the action).
async function activeReminder(tenantId: string, kind: string, title: string, dueDate: string | null, source: string) {
  if (!dueDate) return;
  await db.insert(reminders).values({ tenantId, kind, title, dueDate, status: 'ACTIVE', source, activatedAt: new Date(), documentId: null });
}

function daysApart(a?: string | null, b?: string | null): number {
  if (!a || !b) return 9999;
  return Math.abs(Math.round((+new Date(a) - +new Date(b)) / 86400000));
}

// ---- Trips (Phase 11) ----
lifeRouter.get('/trips', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const list = await db.select().from(trips).where(eq(trips.tenantId, tid(req))).orderBy(desc(trips.startDate));
  const items = await db.select().from(tripItems).where(eq(tripItems.tenantId, tid(req)));
  res.json({ trips: list.map((t) => ({ ...t, items: items.filter((i) => i.tripId === t.id) })) });
});

const tripSchema = z.object({ title: z.string().min(1), destination: z.string().optional(), startDate: z.string().optional(), endDate: z.string().optional() });
lifeRouter.post('/trips', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const b = tripSchema.parse(req.body);
  const [row] = await db.insert(trips).values({ tenantId: tid(req), ...b, status: 'upcoming' }).returning();
  await activeReminder(tid(req), 'expiry', `Trip: ${b.title}`, b.startDate ?? null, 'trip');
  await audit({ action: 'trip.created', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'trip', targetId: row.id, req });
  res.status(201).json({ trip: row });
});

// ---- Purchases & warranties (Phase 12) ----
lifeRouter.get('/purchases', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  res.json({ purchases: await db.select().from(purchases).where(eq(purchases.tenantId, tid(req))).orderBy(desc(purchases.createdAt)) });
});
const purchaseSchema = z.object({ item: z.string().min(1), merchant: z.string().optional(), amount: z.string().optional(), purchaseDate: z.string().optional(), warrantyExpiry: z.string().optional() });
lifeRouter.post('/purchases', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const b = purchaseSchema.parse(req.body);
  const [row] = await db.insert(purchases).values({ tenantId: tid(req), item: b.item, merchant: b.merchant, amount: b.amount, purchaseDate: b.purchaseDate, warrantyExpiry: b.warrantyExpiry, isAsset: !!b.warrantyExpiry, category: 'purchase' }).returning();
  if (b.warrantyExpiry) await activeReminder(tid(req), 'expiry', `Warranty expires — ${b.item}`, b.warrantyExpiry, 'warranty');
  await audit({ action: 'purchase.created', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'purchase', targetId: row.id, req });
  res.status(201).json({ purchase: row });
});

// ---- Personal subscription tracking (Phase 13) ----
lifeRouter.get('/tracked-subscriptions', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  res.json({ subscriptions: await db.select().from(trackedSubscriptions).where(eq(trackedSubscriptions.tenantId, tid(req))).orderBy(desc(trackedSubscriptions.createdAt)) });
});
const subSchema = z.object({ name: z.string().min(1), category: z.string().optional(), amount: z.string().optional(), cycle: z.string().optional(), renewalDate: z.string().optional() });
lifeRouter.post('/tracked-subscriptions', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const b = subSchema.parse(req.body);
  const [row] = await db.insert(trackedSubscriptions).values({ tenantId: tid(req), ...b, source: 'manual' }).returning();
  await activeReminder(tid(req), 'renewal', `${b.name} renews`, b.renewalDate ?? null, 'subscription');
  res.status(201).json({ subscription: row });
});

// ---- Email → entity: confirm a detected item (Phases 10→11/12/13) ----
lifeRouter.post('/inbox/detected/:id/confirm', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const tenantId = tid(req);
  const [item] = await db.select().from(detectedItems).where(and(eq(detectedItems.id, req.params.id), eq(detectedItems.tenantId, tenantId), eq(detectedItems.status, 'pending'))).limit(1);
  if (!item) throw new AppError(404, 'not_found', 'Detected item not found');
  const e = item.extracted as any;
  let entityType = ''; let entityId = '';

  if (item.type === 'travel' || item.type === 'ticket') {
    const date = e.date ?? e.checkIn ?? null;
    const destination = e.to ?? e.name ?? e.venue ?? 'Trip';
    // Email-to-trip matching: attach to an overlapping trip, else create one.
    const existing = await db.select().from(trips).where(eq(trips.tenantId, tenantId));
    let trip = existing.find((t) => daysApart(t.startDate, date) <= 5 || daysApart(t.endDate, date) <= 5);
    if (!trip) {
      [trip] = await db.insert(trips).values({ tenantId, title: `Trip to ${destination}`, destination, startDate: date, endDate: e.checkOut ?? date, status: 'upcoming' }).returning();
    }
    const kind = e.kind ?? (item.type === 'ticket' ? 'ticket' : 'flight');
    await db.insert(tripItems).values({ tripId: trip.id, tenantId, kind, details: e, startDate: date, endDate: e.checkOut ?? date });
    await activeReminder(tenantId, 'expiry', `${kind} — ${trip.title}`, date, 'trip');
    entityType = 'trip'; entityId = trip.id;
  } else if (item.type === 'purchase' || item.type === 'warranty') {
    const hasWarranty = !!e.warrantyExpiry || item.type === 'warranty';
    const [p] = await db.insert(purchases).values({
      tenantId, merchant: e.merchant, item: e.item ?? e.product ?? item.rawSubject ?? 'Purchase',
      amount: e.amount, purchaseDate: e.date, category: item.type === 'warranty' ? 'warranty' : 'purchase',
      isAsset: hasWarranty, warrantyExpiry: e.warrantyExpiry ?? e.expiry ?? null,
    }).returning();
    if (p.warrantyExpiry) await activeReminder(tenantId, 'expiry', `Warranty expires — ${p.item}`, p.warrantyExpiry, 'warranty');
    entityType = 'purchase'; entityId = p.id;
  } else if (item.type === 'subscription') {
    const [s] = await db.insert(trackedSubscriptions).values({ tenantId, name: e.name ?? 'Subscription', amount: e.amount, cycle: e.cycle ?? 'monthly', renewalDate: e.renewalDate, source: item.source === 'bank' ? 'bank' : 'email' }).returning();
    await activeReminder(tenantId, 'renewal', `${s.name} renews`, s.renewalDate ?? null, 'subscription');
    entityType = 'subscription'; entityId = s.id;
  } else {
    throw new AppError(400, 'unsupported', 'This item type cannot be confirmed into an entity');
  }

  await db.update(detectedItems).set({ status: 'confirmed', createdEntityType: entityType, createdEntityId: entityId }).where(eq(detectedItems.id, item.id));
  await audit({ action: 'inbox.confirmed', actorId: req.auth!.sub, tenantId, targetType: entityType, targetId: entityId, metadata: { from: item.type }, req });
  res.json({ entityType, entityId });
});
