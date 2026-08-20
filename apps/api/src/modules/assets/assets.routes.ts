import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { assets, documents, reminders } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requireModule } from '../../middleware/requireModule';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';

export const assetsRouter = Router();
assetsRouter.use(requireAuth, requireMfaSatisfied, requireModule('assets'));
const tid = (req: any): string => {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have assets');
  return req.auth.tid;
};

// Which detail fields are renewal dates we should turn into reminders, per kind.
// Each entry: [detailKey, humanLabel].
const RENEWAL_FIELDS: Record<string, [string, string][]> = {
  vehicle: [['motDate', 'MOT'], ['taxDate', 'road tax'], ['insuranceDate', 'insurance']],
  property: [['insuranceDate', 'home insurance'], ['mortgageEnd', 'mortgage deal']],
};
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Sync renewal reminders for an asset from its detail dates. Idempotent: we clear
// this asset's prior renewal reminders (matched by title) then recreate current ones.
async function syncAssetReminders(tenantId: string, asset: { id: string; kind: string; name: string; details: any }) {
  const fields = RENEWAL_FIELDS[asset.kind] ?? [];
  for (const [key, label] of fields) {
    const title = `${asset.name} — ${label} renewal`;
    await db.delete(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.kind, 'asset_renewal'), eq(reminders.title, title)));
    const due = asset.details?.[key];
    if (isDate(due)) {
      await db.insert(reminders).values({
        tenantId, documentId: null, kind: 'asset_renewal', title, dueDate: due,
        status: 'ACTIVE', source: 'asset', activatedAt: new Date(), recurrence: 'yearly', leadDays: [30, 7],
      });
    }
  }
}

assetsRouter.get('/', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const conds = [eq(assets.tenantId, tid(req))];
  if (kind) conds.push(eq(assets.kind, kind));
  const rows = await db.select().from(assets).where(and(...conds)).orderBy(desc(assets.createdAt));
  res.json({ assets: rows });
});

assetsRouter.get('/:id', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const [asset] = await db.select().from(assets).where(and(eq(assets.id, req.params.id), eq(assets.tenantId, tid(req)))).limit(1);
  if (!asset) throw new AppError(404, 'not_found', 'Asset not found');
  const docs = await db.select().from(documents).where(and(eq(documents.assetId, asset.id), isNull(documents.deletedAt))).orderBy(desc(documents.createdAt));
  res.json({ asset, documents: docs });
});

const assetSchema = z.object({
  kind: z.enum(['property', 'vehicle']),
  name: z.string().min(1).max(120),
  details: z.record(z.any()).optional(),
});
assetsRouter.post('/', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const b = assetSchema.parse(req.body);
  const tenantId = tid(req);
  const [row] = await db.insert(assets).values({ tenantId, kind: b.kind, name: b.name, details: (b.details ?? {}) as any }).returning();
  await syncAssetReminders(tenantId, row as any);
  await audit({ action: 'asset.created', actorId: req.auth!.sub, tenantId, targetType: 'asset', targetId: row.id, metadata: { kind: b.kind }, req });
  res.status(201).json({ asset: row });
});

const updateSchema = z.object({ name: z.string().min(1).max(120).optional(), details: z.record(z.any()).optional() });
assetsRouter.patch('/:id', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const b = updateSchema.parse(req.body);
  const tenantId = tid(req);
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.name !== undefined) set.name = b.name;
  if (b.details !== undefined) set.details = b.details;
  const [row] = await db.update(assets).set(set).where(and(eq(assets.id, req.params.id), eq(assets.tenantId, tenantId))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Asset not found');
  await syncAssetReminders(tenantId, row as any);
  await audit({ action: 'asset.updated', actorId: req.auth!.sub, tenantId, targetType: 'asset', targetId: row.id, req });
  res.json({ asset: row });
});

assetsRouter.delete('/:id', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const tenantId = tid(req);
  const [row] = await db.delete(assets).where(and(eq(assets.id, req.params.id), eq(assets.tenantId, tenantId))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Asset not found');
  // Clear this asset's renewal reminders.
  for (const [, label] of RENEWAL_FIELDS[row.kind] ?? []) {
    await db.delete(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.kind, 'asset_renewal'), eq(reminders.title, `${row.name} — ${label} renewal`)));
  }
  await audit({ action: 'asset.deleted', actorId: req.auth!.sub, tenantId, targetType: 'asset', targetId: row.id, req });
  res.json({ deleted: true });
});
