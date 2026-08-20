import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { desc, sql, eq as eqOp } from 'drizzle-orm';
import { db } from '../../db/client';
import { sitePages, siteSubscribers, plans } from '../../db/schema';
import { MODULES, effectiveModules, netAmount } from '../../lib/modules';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { DEFAULT_SITE_PAGES, defaultForSlug } from '../../lib/siteContent';

// Marketing-site CMS. Public GET endpoints serve the current content to the landing
// site at vaulmo.com (a different origin, so they send permissive CORS). Admin GET/PUT
// endpoints let a platform admin edit any page from the console. Content falls back to
// the built-in defaults for any page that hasn't been customised yet.
export const siteRouter = Router();

// Public marketing content is readable cross-origin from the landing domain.
siteRouter.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  next();
});

// Merge stored pages over the defaults so unedited pages still return sensible content.
async function allPages() {
  const rows = await db.select().from(sitePages);
  const byslug = new Map(rows.map((r) => [r.slug, r]));
  return DEFAULT_SITE_PAGES.map((d) => {
    const row = byslug.get(d.slug);
    return { slug: d.slug, title: row?.title ?? d.title, content: row?.content ?? d.content, updatedAt: row?.updatedAt ?? null };
  });
}

siteRouter.get('/pages', async (_req, res) => {
  res.json({ pages: await allPages() });
});

siteRouter.get('/pages/:slug', async (req, res) => {
  const rows = await db.select().from(sitePages).where(eq(sitePages.slug, req.params.slug)).limit(1);
  const def = defaultForSlug(req.params.slug);
  if (!rows[0] && !def) throw new AppError(404, 'not_found', 'Unknown page');
  res.json(rows[0] ?? { slug: def!.slug, title: def!.title, content: def!.content, updatedAt: null });
});

// ---- Public: subscription plans for the marketing pricing page ----
// Mirrors what a super-admin creates/activates in the console: only ACTIVE plans are
// shown, ordered as configured, with their price, any discount, and the features
// (modules) each plan unlocks. Public + CORS-open so vaulmo.com can render pricing.
const MODULE_NAME: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.key, m.name]));
siteRouter.get('/plans', async (_req, res) => {
  const rows = await db.select().from(plans).where(eqOp(plans.active, true)).orderBy(plans.sort);
  const list = rows.map((p) => {
    const mods = effectiveModules((p as any).modules);
    const features = mods.map((k) => MODULE_NAME[k] ?? k);
    const members = (p.entitlements as any)?.members;
    if (typeof members === 'number') features.unshift(members >= 999 ? 'Unlimited household members' : `Up to ${members} household member${members === 1 ? '' : 's'}`);
    return {
      key: p.key, name: p.name, amount: p.amount, currency: p.currency, interval: p.interval,
      discountPercent: (p as any).discountPercent ?? 0, discountLabel: (p as any).discountLabel ?? null,
      netAmount: netAmount(p.amount, (p as any).discountPercent ?? 0),
      features,
    };
  });
  res.json({ modules: MODULES, plans: list });
});

// ---- Public: waitlist sign-up (captured to the CRM) ----
const subscribeSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  notifyAtLaunch: z.coerce.boolean().optional(),
  source: z.string().max(40).optional(),
});
siteRouter.post('/subscribe', async (req, res) => {
  const b = subscribeSchema.parse(req.body);
  await db.insert(siteSubscribers).values({
    name: b.name.trim(), email: b.email.toLowerCase().trim(),
    notifyAtLaunch: b.notifyAtLaunch ?? true, source: b.source ?? 'website',
  }).onConflictDoUpdate({ target: siteSubscribers.email, set: { name: b.name.trim(), notifyAtLaunch: b.notifyAtLaunch ?? true } });
  await audit({ action: 'site.subscribed', metadata: { email: b.email.toLowerCase().trim(), source: b.source ?? 'website' }, req });
  res.status(201).json({ ok: true });
});

// Handle the CORS preflight for the public subscribe POST.
siteRouter.options('/subscribe', (_req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.status(204).end();
});

// ---- Admin: edit site content (platform admins only) ----
const adminGuard = [requireAuth, requireMfaSatisfied, requirePermission(PERMISSIONS.PLATFORM_MANAGE)];

siteRouter.get('/admin/pages', ...adminGuard, async (_req, res) => {
  res.json({ pages: await allPages() });
});

const pageSchema = z.object({ title: z.string().min(1).max(120).optional(), content: z.any() });
siteRouter.put('/admin/pages/:slug', ...adminGuard, async (req, res) => {
  const slug = req.params.slug;
  const def = defaultForSlug(slug);
  if (!def) throw new AppError(404, 'unknown_page', 'That page does not exist');
  const body = pageSchema.parse(req.body);
  const title = body.title ?? def.title;
  const [row] = await db.insert(sitePages).values({ slug, title, content: body.content ?? def.content })
    .onConflictDoUpdate({ target: sitePages.slug, set: { title, content: body.content ?? def.content, updatedAt: new Date() } })
    .returning();
  await audit({ action: 'site.page.updated', actorId: req.auth!.sub, targetType: 'site_page', targetId: slug, req });
  res.json({ page: row });
});

// Admin: the captured waitlist (feeds the CRM). List + CSV export.
siteRouter.get('/admin/subscribers', ...adminGuard, async (_req, res) => {
  const rows = await db.select().from(siteSubscribers).orderBy(desc(siteSubscribers.createdAt));
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(siteSubscribers);
  res.json({ total: Number(count) || 0, subscribers: rows });
});
siteRouter.get('/admin/subscribers.csv', ...adminGuard, async (_req, res) => {
  const rows = await db.select().from(siteSubscribers).orderBy(desc(siteSubscribers.createdAt));
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['name,email,notify_at_launch,source,created_at',
    ...rows.map((r) => [r.name, r.email, r.notifyAtLaunch, r.source, r.createdAt?.toISOString()].map(esc).join(','))].join('\n');
  res.setHeader('content-type', 'text/csv');
  res.setHeader('content-disposition', 'attachment; filename="vaulmo-waitlist.csv"');
  res.send(csv);
});

// Reset a page back to the built-in default copy.
siteRouter.post('/admin/pages/:slug/reset', ...adminGuard, async (req, res) => {
  const def = defaultForSlug(req.params.slug);
  if (!def) throw new AppError(404, 'unknown_page', 'That page does not exist');
  await db.delete(sitePages).where(eq(sitePages.slug, req.params.slug));
  await audit({ action: 'site.page.reset', actorId: req.auth!.sub, targetType: 'site_page', targetId: req.params.slug, req });
  res.json({ slug: def.slug, title: def.title, content: def.content });
});
