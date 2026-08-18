import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { tenants, users, auditLogs, fileObjects, userRoles, roles, subscriptions, plans, documents, reminders, familyMembers, nextOfKin, supportTickets, crmProfiles, crmNotes, cmsArticles } from '../../db/schema';
import { AppError } from '../../middleware/error';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
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
