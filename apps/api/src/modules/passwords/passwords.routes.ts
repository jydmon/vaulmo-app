import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { secureItems } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requireModule } from '../../middleware/requireModule';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { encrypt, decrypt } from '../../lib/crypto';

// Password / secrets vault (SEC-30). Strict owner access: every query is scoped to
// the calling user (owner_user_id), so no other household member — and no admin,
// including super_admin — can list or reveal another user's secrets. The sensitive
// payload is AES-256-GCM encrypted at rest; list endpoints NEVER return the secret,
// and each reveal is written to the audit log.
export const passwordsRouter = Router();
passwordsRouter.use(requireAuth, requireMfaSatisfied, requireModule('passwords'));

function tid(req: any): string {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have a password vault');
  return req.auth.tid;
}
// The owner scope used by EVERY query — tenant AND the calling user.
const ownerScope = (req: any) => and(eq(secureItems.tenantId, tid(req)), eq(secureItems.ownerUserId, req.auth!.sub));

// Non-sensitive view (safe to list). Never includes the decrypted secret.
const publicView = (r: any) => ({
  id: r.id, kind: r.kind, label: r.label, username: r.username, url: r.url,
  category: r.category, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

// The sensitive payload we encrypt as one JSON blob.
const secretSchema = z.object({
  password: z.string().max(2000).optional(),
  note: z.string().max(8000).optional(),
  cardNumber: z.string().max(64).optional(),
  pin: z.string().max(32).optional(),
}).default({});

const createSchema = z.object({
  kind: z.enum(['login', 'card', 'note', 'pin']).default('login'),
  label: z.string().min(1).max(120),
  username: z.string().max(200).nullable().optional(),
  url: z.string().max(400).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  secret: secretSchema,
});

passwordsRouter.get('/', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const rows = await db.select().from(secureItems).where(ownerScope(req)).orderBy(desc(secureItems.updatedAt));
  res.json({ items: rows.map(publicView) });
});

passwordsRouter.post('/', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const b = createSchema.parse(req.body);
  const [row] = await db.insert(secureItems).values({
    tenantId: tid(req), ownerUserId: req.auth!.sub,
    kind: b.kind, label: b.label, username: b.username ?? null, url: b.url ?? null, category: b.category ?? null,
    secretCipher: encrypt(JSON.stringify(b.secret ?? {})),
  }).returning();
  await audit({ action: 'password.created', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'secure_item', targetId: row.id, req });
  res.status(201).json({ item: publicView(row) });
});

// Reveal the decrypted secret — the one sensitive read. Owner-scoped and audited.
passwordsRouter.post('/:id/reveal', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const [row] = await db.select().from(secureItems).where(and(ownerScope(req), eq(secureItems.id, req.params.id))).limit(1);
  if (!row) throw new AppError(404, 'not_found', 'Item not found');
  let secret: any = {};
  try { secret = JSON.parse(decrypt(row.secretCipher)); } catch { secret = {}; }
  await audit({ action: 'password.revealed', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'secure_item', targetId: row.id, req });
  res.json({ id: row.id, secret });
});

const updateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  username: z.string().max(200).nullable().optional(),
  url: z.string().max(400).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  secret: secretSchema.optional(),
});
passwordsRouter.patch('/:id', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const b = updateSchema.parse(req.body);
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.label !== undefined) set.label = b.label;
  if (b.username !== undefined) set.username = b.username;
  if (b.url !== undefined) set.url = b.url;
  if (b.category !== undefined) set.category = b.category;
  if (b.secret !== undefined) set.secretCipher = encrypt(JSON.stringify(b.secret));
  const [row] = await db.update(secureItems).set(set).where(and(ownerScope(req), eq(secureItems.id, req.params.id))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Item not found');
  await audit({ action: 'password.updated', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'secure_item', targetId: row.id, req });
  res.json({ item: publicView(row) });
});

passwordsRouter.delete('/:id', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const [row] = await db.delete(secureItems).where(and(ownerScope(req), eq(secureItems.id, req.params.id))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Item not found');
  await audit({ action: 'password.deleted', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'secure_item', targetId: row.id, req });
  res.json({ deleted: true });
});
