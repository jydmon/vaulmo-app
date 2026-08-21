import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { chargeZones, zoneAlerts, assets } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { CHARGE_ZONES } from '../../lib/chargeZones';

// Seed the zone catalogue on first use (idempotent), mirroring the automations pattern.
async function ensureZones() {
  const rows = await db.select().from(chargeZones);
  if (rows.length) return rows;
  await db.insert(chargeZones).values(CHARGE_ZONES as any).onConflictDoNothing();
  return db.select().from(chargeZones);
}

// Great-circle distance in km.
function distKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const drivingRouter = Router();
drivingRouter.use(requireAuth, requireMfaSatisfied);
const tid = (req: any) => { if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only household accounts can use driving alerts'); return req.auth.tid as string; };

// The zone catalogue. With lat/lng, returns the nearest zones first (so the app can
// register the closest ~20 as geofences) with a distanceKm for each.
drivingRouter.get('/zones', async (req, res) => {
  const rows = (await ensureZones()).filter((z) => z.active);
  const lat = Number((req.query as any).lat), lng = Number((req.query as any).lng);
  const limit = Math.min(Number((req.query as any).limit) || 200, 500);
  let zones = rows as any[];
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    zones = zones.map((z) => ({ ...z, distanceKm: Math.round(distKm(lat, lng, z.lat, z.lng) * 10) / 10 }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
  res.json({ zones: zones.slice(0, limit) });
});

// The household's vehicles + their emission-compliance settings (stored on the asset).
drivingRouter.get('/vehicles', async (req, res) => {
  const rows = await db.select().from(assets).where(and(eq(assets.tenantId, tid(req)), eq(assets.kind, 'vehicle')));
  res.json({ vehicles: rows.map((v) => ({ id: v.id, name: v.name, registration: (v.details as any)?.registration ?? null, fuelType: (v.details as any)?.fuelType ?? null, compliant: (v.details as any)?.emissionCompliant ?? null })) });
});

// Set a vehicle's fuel type + whether it meets emission standards (ULEZ/CAZ/LEZ).
const vehSchema = z.object({ fuelType: z.enum(['petrol', 'diesel', 'hybrid', 'electric', 'other']).optional(), compliant: z.boolean().optional() });
drivingRouter.patch('/vehicles/:id', async (req, res) => {
  const b = vehSchema.parse(req.body);
  const [v] = await db.select().from(assets).where(and(eq(assets.id, req.params.id), eq(assets.tenantId, tid(req)), eq(assets.kind, 'vehicle'))).limit(1);
  if (!v) throw new AppError(404, 'not_found', 'Vehicle not found');
  const details: any = { ...(v.details as any) };
  if (b.fuelType !== undefined) details.fuelType = b.fuelType;
  if (b.compliant !== undefined) details.emissionCompliant = b.compliant;
  const [row] = await db.update(assets).set({ details, updatedAt: new Date() }).where(eq(assets.id, v.id)).returning();
  res.json({ vehicle: { id: row.id, name: row.name, registration: (row.details as any)?.registration ?? null, fuelType: (row.details as any)?.fuelType ?? null, compliant: (row.details as any)?.emissionCompliant ?? null } });
});

// Log an alert the app has shown the driver (for the in-app history).
const alertSchema = z.object({ zoneKey: z.string().max(60), zoneName: z.string().max(160), vehicleLabel: z.string().max(120).optional(), amount: z.number().int().nonnegative(), currency: z.string().max(8).default('GBP') });
drivingRouter.post('/alert', async (req, res) => {
  const b = alertSchema.parse(req.body);
  await db.insert(zoneAlerts).values({ userId: req.auth!.sub, tenantId: req.auth!.tid ?? null, zoneKey: b.zoneKey, zoneName: b.zoneName, vehicleLabel: b.vehicleLabel ?? null, amount: b.amount, currency: b.currency });
  await audit({ action: 'driving.alert', actorId: req.auth!.sub, metadata: { zone: b.zoneKey, amount: b.amount }, req });
  res.status(201).json({ ok: true });
});

// Recent alerts for the in-app history.
drivingRouter.get('/alerts', async (req, res) => {
  const rows = await db.select().from(zoneAlerts).where(eq(zoneAlerts.userId, req.auth!.sub)).orderBy(desc(zoneAlerts.at)).limit(50);
  res.json({ alerts: rows });
});

// ---------------- Admin: manage the zone catalogue (platform admins only) ----------------
export const adminDrivingRouter = Router();
adminDrivingRouter.use(requireAuth, requireMfaSatisfied, requirePermission(PERMISSIONS.PLATFORM_MANAGE));

const scheduleSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).nullable().optional();
const zoneSchema = z.object({
  key: z.string().min(2).max(60),
  name: z.string().min(1).max(160),
  country: z.string().min(2).max(2).default('GB'),
  type: z.enum(['ulez', 'caz', 'lez', 'congestion', 'toll', 'noparking']),
  lat: z.number(), lng: z.number(),
  radiusM: z.number().int().positive().max(100000),
  amount: z.number().int().nonnegative().default(0),
  currency: z.string().max(8).default('GBP'),
  unit: z.enum(['day', 'trip']).default('day'),
  compliantFree: z.boolean().default(false),
  hours: z.string().max(200).nullable().optional(),
  schedule: scheduleSchema,
  infoUrl: z.string().max(300).nullable().optional(),
  active: z.boolean().default(true),
});

adminDrivingRouter.get('/zones', async (_req, res) => {
  await ensureZones();
  const rows = await db.select().from(chargeZones).orderBy(chargeZones.country, chargeZones.name);
  res.json({ zones: rows });
});
// Create or update by key.
adminDrivingRouter.post('/zones', async (req, res) => {
  const b = zoneSchema.parse(req.body);
  const values: any = { ...b, hours: b.hours ?? null, infoUrl: b.infoUrl ?? null, schedule: (b.schedule ?? null) as any };
  const [existing] = await db.select().from(chargeZones).where(eq(chargeZones.key, b.key)).limit(1);
  const [row] = existing
    ? await db.update(chargeZones).set(values).where(eq(chargeZones.key, b.key)).returning()
    : await db.insert(chargeZones).values(values).returning();
  await audit({ action: 'driving.zone.upserted', actorId: req.auth!.sub, targetType: 'charge_zone', targetId: b.key, req });
  res.status(201).json({ zone: row });
});
adminDrivingRouter.patch('/zones/:id', async (req, res) => {
  const b = zoneSchema.partial().parse(req.body);
  const set: any = { ...b };
  if (b.schedule !== undefined) set.schedule = b.schedule as any;
  const [row] = await db.update(chargeZones).set(set).where(eq(chargeZones.id, req.params.id)).returning();
  if (!row) throw new AppError(404, 'not_found', 'Zone not found');
  await audit({ action: 'driving.zone.updated', actorId: req.auth!.sub, targetId: req.params.id, req });
  res.json({ zone: row });
});
adminDrivingRouter.delete('/zones/:id', async (req, res) => {
  await db.delete(chargeZones).where(eq(chargeZones.id, req.params.id));
  await audit({ action: 'driving.zone.deleted', actorId: req.auth!.sub, targetId: req.params.id, req });
  res.json({ deleted: true });
});
