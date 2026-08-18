import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { featureFlags, announcements, platformSettings, users } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { env } from '../../env';

// Settings keys that are safe to expose to end users.
const PUBLIC_SETTING_KEYS = ['policies', 'mobile', 'support'];

function flagOn(flag: any, opts: { internal: boolean; isSuper: boolean }) {
  if (!flag.enabled) return false;
  if (flag.rollout === 'everyone') return true;
  if (flag.rollout === 'off') return false;
  return opts.internal || opts.isSuper; // internal | pilot
}

// ---------------- Public (authenticated users) ----------------
export const configPublicRouter = Router();
configPublicRouter.use(requireAuth);

configPublicRouter.get('/public', async (req, res) => {
  const isSuper = req.auth!.roles.includes('super_admin');
  const [u] = await db.select({ it: users.isInternalTester }).from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  const internal = !!u?.it;
  const now = new Date();

  const [flagRows, annRows, setRows] = await Promise.all([
    db.select().from(featureFlags),
    db.select().from(announcements).where(eq(announcements.active, true)).orderBy(desc(announcements.createdAt)),
    db.select().from(platformSettings).where(inArray(platformSettings.key, PUBLIC_SETTING_KEYS)),
  ]);

  const flags: Record<string, boolean> = {};
  for (const f of flagRows) flags[f.key] = flagOn(f, { internal, isSuper });

  const visible = annRows.filter((a) => {
    if (a.startsAt && a.startsAt > now) return false;
    if (a.endsAt && a.endsAt < now) return false;
    if (a.audience === 'admins') return isSuper;
    if (a.audience === 'customers') return !isSuper;
    return true;
  }).map((a) => ({ id: a.id, title: a.title, body: a.body, level: a.level }));

  const settings: Record<string, any> = {};
  for (const s of setRows) settings[s.key] = s.value;

  res.json({ environment: env.APP_ENV, flags, announcements: visible, settings });
});

// ---------------- Admin (Super Admin) ----------------
export const adminConfigRouter = Router();
adminConfigRouter.use(requireAuth, requireMfaSatisfied, requirePermission(PERMISSIONS.PLATFORM_MANAGE));

adminConfigRouter.get('/', async (_req, res) => {
  const [flags, anns, setRows] = await Promise.all([
    db.select().from(featureFlags).orderBy(featureFlags.key),
    db.select().from(announcements).orderBy(desc(announcements.createdAt)),
    db.select().from(platformSettings),
  ]);
  const settings: Record<string, any> = {};
  for (const s of setRows) settings[s.key] = s.value;
  res.json({ environment: env.APP_ENV, flags, announcements: anns, settings });
});

// Feature flags
const flagSchema = z.object({ key: z.string().min(1).max(80), description: z.string().max(300).optional(), enabled: z.boolean().optional(), rollout: z.enum(['off', 'internal', 'pilot', 'everyone']).optional() });
adminConfigRouter.put('/flags', async (req, res) => {
  const b = flagSchema.parse(req.body);
  const key = b.key.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const [existing] = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  let row;
  if (existing) {
    [row] = await db.update(featureFlags).set({ description: b.description ?? existing.description, enabled: b.enabled ?? existing.enabled, rollout: b.rollout ?? existing.rollout, updatedAt: new Date() }).where(eq(featureFlags.key, key)).returning();
  } else {
    [row] = await db.insert(featureFlags).values({ key, description: b.description, enabled: b.enabled ?? false, rollout: b.rollout ?? 'off' }).returning();
  }
  await audit({ action: 'admin.flag.set', actorId: req.auth!.sub, targetType: 'flag', targetId: key, metadata: { rollout: row.rollout, enabled: row.enabled }, req });
  res.json({ flag: row });
});
adminConfigRouter.delete('/flags/:key', async (req, res) => {
  await db.delete(featureFlags).where(eq(featureFlags.key, req.params.key));
  await audit({ action: 'admin.flag.deleted', actorId: req.auth!.sub, targetType: 'flag', targetId: req.params.key, req });
  res.json({ ok: true });
});

// Announcements
const annSchema = z.object({ title: z.string().min(1).max(160), body: z.string().max(2000).optional(), level: z.enum(['info', 'warning', 'critical']).optional(), audience: z.enum(['all', 'customers', 'admins']).optional(), active: z.boolean().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() });
adminConfigRouter.post('/announcements', async (req, res) => {
  const b = annSchema.parse(req.body);
  const [a] = await db.insert(announcements).values({ title: b.title, body: b.body ?? '', level: b.level ?? 'info', audience: b.audience ?? 'all', active: b.active ?? true, startsAt: b.startsAt ? new Date(b.startsAt) : null, endsAt: b.endsAt ? new Date(b.endsAt) : null }).returning();
  await audit({ action: 'admin.announcement.created', actorId: req.auth!.sub, targetType: 'announcement', targetId: a.id, req });
  res.status(201).json({ announcement: a });
});
adminConfigRouter.put('/announcements/:id', async (req, res) => {
  const b = annSchema.partial().parse(req.body);
  const [a] = await db.update(announcements).set({
    ...(b.title !== undefined ? { title: b.title } : {}),
    ...(b.body !== undefined ? { body: b.body } : {}),
    ...(b.level !== undefined ? { level: b.level } : {}),
    ...(b.audience !== undefined ? { audience: b.audience } : {}),
    ...(b.active !== undefined ? { active: b.active } : {}),
    ...(b.startsAt !== undefined ? { startsAt: b.startsAt ? new Date(b.startsAt) : null } : {}),
    ...(b.endsAt !== undefined ? { endsAt: b.endsAt ? new Date(b.endsAt) : null } : {}),
  }).where(eq(announcements.id, req.params.id)).returning();
  if (!a) throw new AppError(404, 'not_found', 'Announcement not found');
  await audit({ action: 'admin.announcement.updated', actorId: req.auth!.sub, targetType: 'announcement', targetId: a.id, req });
  res.json({ announcement: a });
});
adminConfigRouter.delete('/announcements/:id', async (req, res) => {
  await db.delete(announcements).where(eq(announcements.id, req.params.id));
  await audit({ action: 'admin.announcement.deleted', actorId: req.auth!.sub, targetType: 'announcement', targetId: req.params.id, req });
  res.json({ ok: true });
});

// Platform settings (key/value)
const settingSchema = z.object({ key: z.string().min(1).max(80), value: z.any() });
adminConfigRouter.put('/settings', async (req, res) => {
  const b = settingSchema.parse(req.body);
  const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, b.key)).limit(1);
  let row;
  if (existing) [row] = await db.update(platformSettings).set({ value: b.value, updatedAt: new Date() }).where(eq(platformSettings.key, b.key)).returning();
  else [row] = await db.insert(platformSettings).values({ key: b.key, value: b.value }).returning();
  await audit({ action: 'admin.setting.updated', actorId: req.auth!.sub, targetType: 'setting', targetId: b.key, req });
  res.json({ setting: row });
});
