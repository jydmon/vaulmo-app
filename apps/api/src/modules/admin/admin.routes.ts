import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { tenants, users, auditLogs, fileObjects, userRoles, roles, subscriptions, plans } from '../../db/schema';
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
