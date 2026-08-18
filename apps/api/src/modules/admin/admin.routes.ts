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

const setSubSchema = z.object({ planKey: z.string().min(1), status: z.string().optional(), months: z.number().int().positive().optional() });
adminRouter.post('/subscriptions/:tenantId', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const body = setSubSchema.parse(req.body);
  const sub = await adminSetSubscription(req.params.tenantId, body);
  await audit({ action: 'admin.subscription.set', actorId: req.auth!.sub, targetType: 'tenant', targetId: req.params.tenantId, metadata: body, req });
  res.json({ subscription: sub });
});
