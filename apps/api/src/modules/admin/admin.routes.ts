import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { tenants, users, auditLogs, fileObjects, userRoles, roles, permissions, rolePermissions, sessions, subscriptions, plans, documents, documentTypes, reminders, familyMembers, nextOfKin, supportTickets, crmProfiles, crmNotes, cmsArticles } from '../../db/schema';
import { AppError } from '../../middleware/error';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission, requireAnyPermission } from '../../middleware/rbac';
import { PERMISSIONS, ADMIN_ROLE_KEYS } from '../../lib/permissions';
import { hashPassword } from '../../lib/password';
import { adminSetSubscription } from '../../lib/billing/service';
import { audit } from '../../lib/audit';

// Admin portal foundation. Platform-level permissions required, so a Tenant Owner
// or Member is denied by RBAC. MFA must be satisfied on the session.
export const adminRouter = Router();
adminRouter.use(requireAuth, requireMfaSatisfied);

adminRouter.get('/tenants', requirePermission(PERMISSIONS.TENANT_READ_ALL), async (_req, res) => {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      type: tenants.type,
      status: tenants.status,
      plan: tenants.plan,
      createdAt: tenants.createdAt,
      members: sql<number>`count(distinct ${users.id})`,
    })
    .from(tenants)
    .leftJoin(users, eq(users.tenantId, tenants.id))
    .groupBy(tenants.id)
    .orderBy(desc(tenants.createdAt));
  res.json({ tenants: rows.map((t) => ({ ...t, members: Number(t.members) })) });
});

adminRouter.get('/users', requirePermission(PERMISSIONS.USER_READ_ALL), async (req, res) => {
  const take = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      status: users.status,
      mfaEnabled: users.mfaEnabled,
      tenant: tenants.name,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .orderBy(desc(users.createdAt))
    .limit(take);

  // roles per user
  const roleRows = await db
    .select({ userId: userRoles.userId, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id));
  const byUser = new Map<string, string[]>();
  for (const r of roleRows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.key]);

  res.json({ users: rows.map((u) => ({ ...u, roles: byUser.get(u.id) ?? [] })) });
});

adminRouter.get('/audit', requirePermission(PERMISSIONS.AUDIT_READ_ALL), async (req, res) => {
  const take = Math.min(Number(req.query.limit ?? 100), 500);
  const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.at)).limit(take);
  res.json({ logs });
});

adminRouter.get('/metrics', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const [[t], [u], [m], [f]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(tenants),
    db.select({ n: sql<number>`count(*)` }).from(users),
    db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.mfaEnabled, true)),
    db.select({ n: sql<number>`count(*)` }).from(fileObjects),
  ]);
  const subRows = await db.select().from(subscriptions);
  const planRows = await db.select().from(plans);
  const planByKey = new Map(planRows.map((p) => [p.key, p]));
  const activeSubs = subRows.filter((s) => s.status === 'active' || s.status === 'trialing');
  const arr = activeSubs.reduce((sum, s) => sum + (s.planKey ? planByKey.get(s.planKey)?.amount ?? 0 : 0), 0);
  res.json({
    tenants: Number(t.n),
    users: Number(u.n),
    mfaUsers: Number(m.n),
    files: Number(f.n),
    activeSubscriptions: activeSubs.length,
    arr, // annual recurring revenue, in minor currency units (e.g. pence)
  });
});

// ---- Customers (tenants + their people, merged) ----
// A "customer" is a tenant account with its members and current subscription. This is the
// single view the platform owner works from (tenant and user are the same concept here).
adminRouter.get('/customers', requirePermission(PERMISSIONS.TENANT_READ_ALL), async (_req, res) => {
  const [tRows, uRows, subRows, roleRows] = await Promise.all([
    db.select().from(tenants).orderBy(desc(tenants.createdAt)),
    db.select({ id: users.id, email: users.email, fullName: users.fullName, tenantId: users.tenantId, status: users.status, mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt }).from(users),
    db.select().from(subscriptions),
    db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)),
  ]);
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.key]);
  const subByTenant = new Map(subRows.map((s) => [s.tenantId, s]));
  const usersByTenant = new Map<string, any[]>();
  for (const u of uRows) {
    if (!u.tenantId) continue;
    const arr = usersByTenant.get(u.tenantId) ?? [];
    arr.push({ ...u, roles: rolesByUser.get(u.id) ?? [] });
    usersByTenant.set(u.tenantId, arr);
  }
  const customers = tRows.map((t) => {
    const members = usersByTenant.get(t.id) ?? [];
    const owner = members.find((m) => (m.roles ?? []).includes('tenant_owner')) ?? members[0] ?? null;
    const sub = subByTenant.get(t.id);
    return {
      id: t.id, name: t.name, type: t.type, status: t.status, plan: t.plan, createdAt: t.createdAt,
      owner: owner ? { email: owner.email, fullName: owner.fullName } : null,
      memberCount: members.length,
      members,
      subscription: sub
        ? { planKey: sub.planKey, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }
        : { planKey: null, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false },
    };
  });
  res.json({ customers });
});

// ---- Subscriptions (platform-owner billing view + control) ----
adminRouter.get('/subscriptions', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const [tRows, subRows, planRows] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name }).from(tenants).orderBy(desc(tenants.createdAt)),
    db.select().from(subscriptions),
    db.select().from(plans),
  ]);
  const planByKey = new Map(planRows.map((p) => [p.key, p]));
  const subByTenant = new Map(subRows.map((s) => [s.tenantId, s]));
  const list = tRows.map((t) => {
    const s = subByTenant.get(t.id);
    const plan = s?.planKey ? planByKey.get(s.planKey) : null;
    return {
      tenantId: t.id, tenantName: t.name,
      planKey: s?.planKey ?? null, status: s?.status ?? 'none',
      currentPeriodEnd: s?.currentPeriodEnd ?? null, cancelAtPeriodEnd: s?.cancelAtPeriodEnd ?? false,
      amount: plan?.amount ?? 0, currency: plan?.currency ?? 'gbp',
    };
  });
  const active = list.filter((s) => s.status === 'active' || s.status === 'trialing');
  const arr = active.reduce((sum, s) => sum + (s.amount ?? 0), 0);
  res.json({ subscriptions: list, plans: planRows, summary: { total: list.length, active: active.length, arr } });
});

// ---- Reporting & analytics (platform owner) ----
// A single aggregated snapshot: KPIs, daily time-series, categorical breakdowns and
// usage rankings, all computed from live tables. `range` is a whole number of days.
adminRouter.get('/analytics', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const range = Math.min(Math.max(Number(req.query.range ?? 30), 7), 365);
  const rows = async (q: any) => (await db.execute(q)).rows as any[];

  const [
    signupUsers, signupTenants, docSeries, activitySeries,
    plansBreakdown, docTypes, ticketStatus, subStatus, topTenants,
    kpiRow,
  ] = await Promise.all([
    rows(sql`select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*)::int n from ${users} where created_at >= now() - make_interval(days => ${range}) group by 1`),
    rows(sql`select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*)::int n from ${tenants} where created_at >= now() - make_interval(days => ${range}) group by 1`),
    rows(sql`select to_char(date_trunc('day', created_at),'YYYY-MM-DD') d, count(*)::int n from documents where created_at >= now() - make_interval(days => ${range}) group by 1`),
    rows(sql`select to_char(date_trunc('day', at),'YYYY-MM-DD') d, count(*)::int n from ${auditLogs} where at >= now() - make_interval(days => ${range}) group by 1`),
    rows(sql`select coalesce(nullif(plan,''),'starter') k, count(*)::int n from ${tenants} group by 1 order by n desc`),
    rows(sql`select coalesce(nullif(type_key,''),'unfiled') k, count(*)::int n from documents group by 1 order by n desc limit 12`),
    rows(sql`select status k, count(*)::int n from support_tickets group by 1`),
    rows(sql`select status k, count(*)::int n from ${subscriptions} group by 1`),
    rows(sql`select t.name k, count(distinct d.id)::int documents, count(distinct u.id)::int members
             from ${tenants} t left join documents d on d.tenant_id = t.id left join ${users} u on u.tenant_id = t.id
             group by t.id, t.name order by documents desc, members desc limit 8`),
    rows(sql`select
             (select count(*) from ${tenants})::int customers,
             (select count(*) from ${users})::int users,
             (select count(*) from ${users} where mfa_enabled = true)::int mfa_users,
             (select count(*) from ${users} where last_login_at >= now() - make_interval(days => ${range}))::int active_users,
             (select count(*) from documents)::int documents,
             (select count(*) from support_tickets where status <> 'closed')::int open_tickets,
             (select count(*) from ${tenants} where created_at >= now() - make_interval(days => ${range}))::int new_customers,
             (select count(*) from ${users} where created_at >= now() - make_interval(days => ${range}))::int new_users`),
  ]);

  // Continuous daily spine so gaps render as zero.
  const map = (arr: any[]) => new Map(arr.map((r) => [r.d, r.n]));
  const mu = map(signupUsers), mt = map(signupTenants), md = map(docSeries), ma = map(activitySeries);
  const days: any[] = [];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = range - 1; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    days.push({ d: key, users: mu.get(key) ?? 0, tenants: mt.get(key) ?? 0, documents: md.get(key) ?? 0, events: ma.get(key) ?? 0 });
  }

  // ARR from active subscriptions.
  const [subRows, planRows] = await Promise.all([db.select().from(subscriptions), db.select().from(plans)]);
  const planByKey = new Map(planRows.map((p) => [p.key, p]));
  const activeSubs = subRows.filter((s) => s.status === 'active' || s.status === 'trialing');
  const arr = activeSubs.reduce((sum, s) => sum + (s.planKey ? planByKey.get(s.planKey)?.amount ?? 0 : 0), 0);

  const k = kpiRow[0] ?? {};
  res.json({
    range,
    kpis: {
      customers: k.customers ?? 0, users: k.users ?? 0, activeUsers: k.active_users ?? 0,
      mfaUsers: k.mfa_users ?? 0, mfaAdoptionPct: k.users ? Math.round((k.mfa_users / k.users) * 100) : 0,
      documents: k.documents ?? 0, openTickets: k.open_tickets ?? 0,
      newCustomers: k.new_customers ?? 0, newUsers: k.new_users ?? 0,
      activeSubscriptions: activeSubs.length, arr,
    },
    series: days,
    breakdowns: {
      plans: plansBreakdown, documentTypes: docTypes, tickets: ticketStatus, subscriptions: subStatus,
    },
    usage: { topTenants },
  });
});

const setSubSchema = z.object({ planKey: z.string().min(1), status: z.string().optional(), months: z.number().int().positive().optional() });
adminRouter.post('/subscriptions/:tenantId', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const body = setSubSchema.parse(req.body);
  const sub = await adminSetSubscription(req.params.tenantId, body);
  await audit({ action: 'admin.subscription.set', actorId: req.auth!.sub, targetType: 'tenant', targetId: req.params.tenantId, metadata: body, req });
  res.json({ subscription: sub });
});

// ================= Troubleshooting: account inspector =================
// A read-only, support-safe snapshot of a customer account for troubleshooting.
// Document CONTENTS are never returned — only titles, types and status. Every
// inspection is written to the audit log. (Full live impersonation is intentionally
// not enabled; this read-only inspector is the sanctioned troubleshooting path.)
adminRouter.get('/customers/:tenantId/inspect', requirePermission(PERMISSIONS.TENANT_READ_ALL), async (req, res) => {
  const tenantId = req.params.tenantId;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new AppError(404, 'not_found', 'Customer not found');

  const [members, docs, rems, fam, nok, sub, tickets, recent, roleRows] = await Promise.all([
    db.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }).from(users).where(eq(users.tenantId, tenantId)),
    db.select({ id: documents.id, title: documents.title, typeKey: documents.typeKey, status: documents.status, createdAt: documents.createdAt }).from(documents).where(eq(documents.tenantId, tenantId)).orderBy(desc(documents.createdAt)).limit(100),
    db.select({ id: reminders.id, title: reminders.title, kind: reminders.kind, dueDate: reminders.dueDate, status: reminders.status }).from(reminders).where(eq(reminders.tenantId, tenantId)).orderBy(desc(reminders.createdAt)).limit(50),
    db.select({ id: familyMembers.id, name: familyMembers.name, relationship: familyMembers.relationship, isDependant: familyMembers.isDependant }).from(familyMembers).where(eq(familyMembers.tenantId, tenantId)),
    db.select({ id: nextOfKin.id, name: nextOfKin.name, email: nextOfKin.email, status: nextOfKin.status }).from(nextOfKin).where(eq(nextOfKin.tenantId, tenantId)),
    db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1),
    db.select({ id: supportTickets.id, subject: supportTickets.subject, status: supportTickets.status, updatedAt: supportTickets.updatedAt }).from(supportTickets).where(eq(supportTickets.tenantId, tenantId)).orderBy(desc(supportTickets.updatedAt)).limit(20),
    db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).orderBy(desc(auditLogs.at)).limit(25),
    db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)),
  ]);
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.key]);

  await audit({ action: 'admin.account.inspected', actorId: req.auth!.sub, targetType: 'tenant', targetId: tenantId, req });
  res.json({
    tenant,
    members: members.map((m) => ({ ...m, roles: rolesByUser.get(m.id) ?? [] })),
    counts: { documents: docs.length, reminders: rems.length, family: fam.length, nok: nok.length, tickets: tickets.length },
    documents: docs, // titles/types/status only — no contents
    reminders: rems, family: fam, nextOfKin: nok,
    subscription: sub[0] ?? null,
    tickets, recentActivity: recent,
  });
});

// ================= CRM: lifecycle, tags & notes =================
async function crmProfileFor(tenantId: string) {
  const [p] = await db.select().from(crmProfiles).where(eq(crmProfiles.tenantId, tenantId)).limit(1);
  if (p) return p;
  const [created] = await db.insert(crmProfiles).values({ tenantId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(crmProfiles).where(eq(crmProfiles.tenantId, tenantId)).limit(1))[0];
}

// Pipeline overview across all customers.
adminRouter.get('/crm', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const [tRows, profiles, subRows] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name, plan: tenants.plan, status: tenants.status, createdAt: tenants.createdAt }).from(tenants).orderBy(desc(tenants.createdAt)),
    db.select().from(crmProfiles),
    db.select().from(subscriptions),
  ]);
  const profByTenant = new Map(profiles.map((p) => [p.tenantId, p]));
  const subByTenant = new Map(subRows.map((s) => [s.tenantId, s]));
  const rows = tRows.map((t) => {
    const p = profByTenant.get(t.id);
    const s = subByTenant.get(t.id);
    return { id: t.id, name: t.name, plan: t.plan, tenantStatus: t.status, createdAt: t.createdAt, stage: p?.stage ?? 'active', tags: p?.tags ?? [], ownerName: p?.ownerName ?? null, subStatus: s?.status ?? 'none' };
  });
  const stages = ['lead', 'onboarding', 'active', 'at_risk', 'churned'];
  const pipeline = Object.fromEntries(stages.map((st) => [st, rows.filter((r) => r.stage === st).length]));
  res.json({ customers: rows, pipeline });
});

adminRouter.get('/crm/:tenantId', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const profile = await crmProfileFor(req.params.tenantId);
  const notes = await db.select().from(crmNotes).where(eq(crmNotes.tenantId, req.params.tenantId)).orderBy(desc(crmNotes.createdAt));
  const authorIds = [...new Set(notes.map((n) => n.authorId).filter(Boolean))] as string[];
  const authors = authorIds.length ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, authorIds)) : [];
  const aName = new Map(authors.map((a) => [a.id, a.fullName]));
  res.json({ profile, notes: notes.map((n) => ({ ...n, authorName: n.authorId ? aName.get(n.authorId) ?? 'Staff' : 'Staff' })) });
});

const crmProfileSchema = z.object({ stage: z.enum(['lead', 'onboarding', 'active', 'at_risk', 'churned']).optional(), tags: z.array(z.string()).optional(), ownerName: z.string().max(120).nullable().optional() });
adminRouter.put('/crm/:tenantId', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = crmProfileSchema.parse(req.body);
  await crmProfileFor(req.params.tenantId);
  const [p] = await db.update(crmProfiles).set({ ...b, updatedAt: new Date() }).where(eq(crmProfiles.tenantId, req.params.tenantId)).returning();
  await audit({ action: 'admin.crm.updated', actorId: req.auth!.sub, targetType: 'tenant', targetId: req.params.tenantId, metadata: b, req });
  res.json({ profile: p });
});

const crmNoteSchema = z.object({ body: z.string().min(1), kind: z.enum(['note', 'call', 'email', 'meeting']).optional() });
adminRouter.post('/crm/:tenantId/notes', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = crmNoteSchema.parse(req.body);
  const [n] = await db.insert(crmNotes).values({ tenantId: req.params.tenantId, authorId: req.auth!.sub, kind: b.kind ?? 'note', body: b.body }).returning();
  res.status(201).json({ note: n });
});

// ================= CMS: knowledge-base admin =================
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
adminRouter.get('/cms/articles', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const rows = await db.select().from(cmsArticles).orderBy(desc(cmsArticles.updatedAt));
  res.json({ articles: rows });
});
adminRouter.get('/cms/articles/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const [a] = await db.select().from(cmsArticles).where(eq(cmsArticles.id, req.params.id)).limit(1);
  if (!a) throw new AppError(404, 'not_found', 'Article not found');
  res.json({ article: a });
});
const articleSchema = z.object({ title: z.string().min(1).max(200), slug: z.string().max(80).optional(), category: z.string().max(80).optional(), excerpt: z.string().max(400).optional(), body: z.string().optional(), status: z.enum(['draft', 'published']).optional() });
adminRouter.post('/cms/articles', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = articleSchema.parse(req.body);
  const slug = slugify(b.slug || b.title);
  const publishedAt = b.status === 'published' ? new Date() : null;
  const [a] = await db.insert(cmsArticles).values({ title: b.title, slug, category: b.category, excerpt: b.excerpt, body: b.body ?? '', status: b.status ?? 'draft', authorId: req.auth!.sub, publishedAt }).returning();
  await audit({ action: 'admin.cms.created', actorId: req.auth!.sub, targetType: 'article', targetId: a.id, req });
  res.status(201).json({ article: a });
});
adminRouter.put('/cms/articles/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = articleSchema.partial().parse(req.body);
  const [existing] = await db.select().from(cmsArticles).where(eq(cmsArticles.id, req.params.id)).limit(1);
  if (!existing) throw new AppError(404, 'not_found', 'Article not found');
  const nowPublished = b.status === 'published' && existing.status !== 'published';
  const [a] = await db.update(cmsArticles).set({
    ...(b.title !== undefined ? { title: b.title } : {}),
    ...(b.slug !== undefined ? { slug: slugify(b.slug) } : {}),
    ...(b.category !== undefined ? { category: b.category } : {}),
    ...(b.excerpt !== undefined ? { excerpt: b.excerpt } : {}),
    ...(b.body !== undefined ? { body: b.body } : {}),
    ...(b.status !== undefined ? { status: b.status } : {}),
    ...(nowPublished ? { publishedAt: new Date() } : {}),
    updatedAt: new Date(),
  }).where(eq(cmsArticles.id, req.params.id)).returning();
  await audit({ action: 'admin.cms.updated', actorId: req.auth!.sub, targetType: 'article', targetId: a.id, metadata: { status: a.status }, req });
  res.json({ article: a });
});
adminRouter.delete('/cms/articles/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  await db.delete(cmsArticles).where(eq(cmsArticles.id, req.params.id));
  await audit({ action: 'admin.cms.deleted', actorId: req.auth!.sub, targetType: 'article', targetId: req.params.id, req });
  res.json({ ok: true });
});

// ================= Document Catalogue (configuration) =================
// The master list of recommended documents plus, per type: which countries it applies to,
// what metadata to extract, and the recommended reminder schedule. Business config, not code.
const fieldSchema = z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(80), type: z.enum(['date', 'string', 'number']), required: z.boolean().optional() });
const docTypeSchema = z.object({
  key: z.string().max(60).optional(),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60),
  countries: z.array(z.string().min(2).max(8)).optional(),
  recommended: z.boolean().optional(),
  metadataSchema: z.array(fieldSchema).optional(),
  reminderLeadDays: z.array(z.number().int().min(0).max(3650)).optional(),
  sort: z.number().int().optional(),
});
const catSlug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'document';

adminRouter.get('/catalogue', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (_req, res) => {
  const rows = await db.select().from(documentTypes).orderBy(documentTypes.sort);
  // Usage: how many stored documents reference each type.
  const counts = (await db.execute(sql`select type_key k, count(*)::int n from documents where type_key is not null group by type_key`)).rows as any[];
  const usage = new Map(counts.map((c) => [c.k, c.n]));
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  const countries = [...new Set(rows.flatMap((r) => r.countries))].sort();
  res.json({ types: rows.map((r) => ({ ...r, inUse: usage.get(r.key) ?? 0 })), categories, countries });
});

adminRouter.post('/catalogue', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = docTypeSchema.parse(req.body);
  const key = catSlug(b.key || b.name);
  const [existing] = await db.select().from(documentTypes).where(eq(documentTypes.key, key)).limit(1);
  if (existing) throw new AppError(409, 'exists', 'A document type with that key already exists');
  const [t] = await db.insert(documentTypes).values({
    key, name: b.name, category: b.category,
    countries: b.countries?.length ? b.countries.map((c) => c.toUpperCase()) : ['GLOBAL'],
    recommended: b.recommended ?? false,
    metadataSchema: (b.metadataSchema ?? []) as any,
    reminderLeadDays: b.reminderLeadDays ?? [180, 90, 30, 7],
    sort: b.sort ?? 100,
  }).returning();
  await audit({ action: 'admin.catalogue.created', actorId: req.auth!.sub, targetType: 'document_type', targetId: t.id, metadata: { key }, req });
  res.status(201).json({ type: t });
});

adminRouter.put('/catalogue/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = docTypeSchema.partial().parse(req.body);
  const [t] = await db.update(documentTypes).set({
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.category !== undefined ? { category: b.category } : {}),
    ...(b.countries !== undefined ? { countries: b.countries.length ? b.countries.map((c) => c.toUpperCase()) : ['GLOBAL'] } : {}),
    ...(b.recommended !== undefined ? { recommended: b.recommended } : {}),
    ...(b.metadataSchema !== undefined ? { metadataSchema: b.metadataSchema as any } : {}),
    ...(b.reminderLeadDays !== undefined ? { reminderLeadDays: b.reminderLeadDays } : {}),
    ...(b.sort !== undefined ? { sort: b.sort } : {}),
  }).where(eq(documentTypes.id, req.params.id)).returning();
  if (!t) throw new AppError(404, 'not_found', 'Document type not found');
  await audit({ action: 'admin.catalogue.updated', actorId: req.auth!.sub, targetType: 'document_type', targetId: t.id, req });
  res.json({ type: t });
});

adminRouter.post('/catalogue/:id/archive', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = z.object({ archived: z.boolean() }).parse(req.body);
  const [t] = await db.update(documentTypes).set({ archived: b.archived }).where(eq(documentTypes.id, req.params.id)).returning();
  if (!t) throw new AppError(404, 'not_found', 'Document type not found');
  await audit({ action: b.archived ? 'admin.catalogue.archived' : 'admin.catalogue.restored', actorId: req.auth!.sub, targetType: 'document_type', targetId: t.id, req });
  res.json({ type: t });
});

// ================= Roles & permissions =================
adminRouter.get('/roles', requirePermission(PERMISSIONS.ADMIN_MANAGE), async (_req, res) => {
  const [roleRows, permRows, rpRows, urRows] = await Promise.all([
    db.select().from(roles),
    db.select().from(permissions),
    db.select().from(rolePermissions),
    db.select({ roleId: userRoles.roleId }).from(userRoles),
  ]);
  const permById = new Map(permRows.map((p) => [p.id, p.key]));
  const permsByRole = new Map<string, string[]>();
  for (const rp of rpRows) permsByRole.set(rp.roleId, [...(permsByRole.get(rp.roleId) ?? []), permById.get(rp.permissionId)!].filter(Boolean));
  const countByRole = new Map<string, number>();
  for (const ur of urRows) countByRole.set(ur.roleId, (countByRole.get(ur.roleId) ?? 0) + 1);
  res.json({
    roles: roleRows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, isAdmin: ADMIN_ROLE_KEYS.includes(r.key), permissions: (permsByRole.get(r.id) ?? []).sort(), members: countByRole.get(r.id) ?? 0 })),
    allPermissions: permRows.map((p) => p.key).sort(),
  });
});

// ================= Admin user management (Super Admin) =================
const ADMIN_ROLE = z.enum(['super_admin', 'security_reviewer', 'support_agent']);
adminRouter.get('/admins', requirePermission(PERMISSIONS.ADMIN_MANAGE), async (_req, res) => {
  const rows = await db.select({ userId: userRoles.userId, roleKey: roles.key }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(inArray(roles.key, ADMIN_ROLE_KEYS));
  const ids = [...new Set(rows.map((r) => r.userId))];
  const us = ids.length ? await db.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt }).from(users).where(inArray(users.id, ids)) : [];
  const rolesByUser = new Map<string, string[]>();
  for (const r of rows) rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.roleKey]);
  res.json({ admins: us.map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] })) });
});

const newAdminSchema = z.object({ email: z.string().email(), fullName: z.string().min(1).max(120), password: z.string().min(10).optional(), role: ADMIN_ROLE });
adminRouter.post('/admins', requirePermission(PERMISSIONS.ADMIN_MANAGE), async (req, res) => {
  const b = newAdminSchema.parse(req.body);
  const email = b.email.toLowerCase();
  let [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) {
    if (!b.password) throw new AppError(400, 'password_required', 'A temporary password is required for a new admin');
    [u] = await db.insert(users).values({ email, fullName: b.fullName, passwordHash: await hashPassword(b.password), status: 'ACTIVE', emailVerified: true }).returning();
  }
  const [role] = await db.select().from(roles).where(eq(roles.key, b.role)).limit(1);
  await db.insert(userRoles).values({ userId: u.id, roleId: role.id }).onConflictDoNothing();
  await audit({ action: 'admin.user.created', actorId: req.auth!.sub, targetType: 'user', targetId: u.id, metadata: { role: b.role, existing: !!b.password ? false : true }, req });
  res.status(201).json({ id: u.id, email: u.email, role: b.role });
});

const setRolesSchema = z.object({ roles: z.array(ADMIN_ROLE) });
adminRouter.put('/admins/:id/roles', requirePermission(PERMISSIONS.ADMIN_MANAGE), async (req, res) => {
  const b = setRolesSchema.parse(req.body);
  // Guard against self-lockout: a Super Admin cannot strip their own super_admin role.
  if (req.params.id === req.auth!.sub && !b.roles.includes('super_admin')) throw new AppError(400, 'self_lockout', 'You cannot remove your own Super Admin role');
  const adminRoleRows = await db.select().from(roles).where(inArray(roles.key, ADMIN_ROLE_KEYS));
  const adminRoleIds = adminRoleRows.map((r) => r.id);
  await db.delete(userRoles).where(and(eq(userRoles.userId, req.params.id), inArray(userRoles.roleId, adminRoleIds)));
  for (const key of b.roles) { const r = adminRoleRows.find((x) => x.key === key); if (r) await db.insert(userRoles).values({ userId: req.params.id, roleId: r.id }).onConflictDoNothing(); }
  await audit({ action: 'admin.user.roles_set', actorId: req.auth!.sub, targetType: 'user', targetId: req.params.id, metadata: { roles: b.roles }, req });
  res.json({ ok: true, roles: b.roles });
});

// ================= Account security administration =================
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']), reason: z.string().max(500).optional() });
adminRouter.post('/users/:id/status', requireAnyPermission(PERMISSIONS.PLATFORM_MANAGE, PERMISSIONS.SECURITY_REVIEW), async (req, res) => {
  const b = statusSchema.parse(req.body);
  // Reactivating also clears any failed-login lockout.
  const patch = b.status === 'ACTIVE' ? { status: b.status, lockedUntil: null, failedLoginCount: 0 } : { status: b.status };
  const [u] = await db.update(users).set(patch).where(eq(users.id, req.params.id)).returning();
  if (!u) throw new AppError(404, 'not_found', 'User not found');
  // Suspending or disabling immediately revokes all active sessions.
  if (b.status !== 'ACTIVE') await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt)));
  await audit({ action: `admin.user.${b.status.toLowerCase()}`, actorId: req.auth!.sub, targetType: 'user', targetId: u.id, metadata: { reason: b.reason }, req });
  res.json({ id: u.id, status: u.status });
});

adminRouter.post('/users/:id/revoke-sessions', requireAnyPermission(PERMISSIONS.PLATFORM_MANAGE, PERMISSIONS.SECURITY_REVIEW), async (req, res) => {
  const revoked = await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, req.params.id), isNull(sessions.revokedAt))).returning();
  await audit({ action: 'admin.user.sessions_revoked', actorId: req.auth!.sub, targetType: 'user', targetId: req.params.id, metadata: { count: revoked.length }, req });
  res.json({ revoked: revoked.length });
});

// ================= Security dashboard =================
adminRouter.get('/security', requireAnyPermission(PERMISSIONS.PLATFORM_MANAGE, PERMISSIONS.SECURITY_REVIEW), async (_req, res) => {
  const rows = async (q: any) => (await db.execute(q)).rows as any[];
  const [failed, denials, emergencyEvents, adminActions, events] = await Promise.all([
    rows(sql`select count(*)::int n from audit_logs where action = 'auth.login' and outcome = 'failure' and at >= now() - interval '7 days'`),
    rows(sql`select count(*)::int n from audit_logs where action = 'authz.denied' and at >= now() - interval '7 days'`),
    rows(sql`select count(*)::int n from audit_logs where action like 'emergency.%' and at >= now() - interval '7 days'`),
    rows(sql`select count(*)::int n from audit_logs where action like 'admin.%' and at >= now() - interval '7 days'`),
    rows(sql`select a.id, a.at, a.action, a.outcome, a.ip, u.email actor from audit_logs a left join users u on u.id = a.actor_id
             where (a.action like 'auth.%' or a.action = 'authz.denied' or a.action like 'emergency.%' or a.action like 'admin.user.%' or a.action like 'mfa.%')
             order by a.at desc limit 40`),
  ]);
  const locked = await db.select({ id: users.id, email: users.email, lockedUntil: users.lockedUntil, failedLoginCount: users.failedLoginCount }).from(users).where(gt(users.lockedUntil, new Date()));
  const [[suspended]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(users).where(inArray(users.status, ['SUSPENDED', 'DISABLED'] as any)),
  ]);
  res.json({
    kpis: {
      failedLogins7d: failed[0]?.n ?? 0,
      activeLockouts: locked.length,
      authzDenials7d: denials[0]?.n ?? 0,
      emergencyEvents7d: emergencyEvents[0]?.n ?? 0,
      adminActions7d: adminActions[0]?.n ?? 0,
      suspendedAccounts: Number(suspended.n),
    },
    lockedAccounts: locked,
    recentEvents: events,
  });
});
