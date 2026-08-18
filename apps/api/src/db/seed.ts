import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db, pool } from './client';
import { roles, permissions, rolePermissions, users, userRoles, documentTypes, tenants } from './schema';
import { ROLE_DEFINITIONS, ALL_PERMISSIONS, ROLES } from '../lib/permissions';
import { CATALOGUE, publicSchema } from '../lib/catalogue';

async function upsertPermission(key: string, name: string) {
  const [existing] = await db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
  if (existing) return existing;
  const [row] = await db.insert(permissions).values({ key, name }).returning();
  return row;
}

async function upsertRole(key: string, name: string, description: string) {
  const [existing] = await db.select().from(roles).where(eq(roles.key, key)).limit(1);
  if (existing) {
    const [row] = await db.update(roles).set({ name, description }).where(eq(roles.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(roles).values({ key, name, description, isSystem: true }).returning();
  return row;
}

async function main() {
  for (const p of ALL_PERMISSIONS) await upsertPermission(p.key, p.name);

  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await upsertRole(key, def.name, def.description);
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    for (const permKey of def.permissions) {
      const [perm] = await db.select().from(permissions).where(eq(permissions.key, permKey)).limit(1);
      if (perm) await db.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id });
    }
  }

  // Bootstrap Super Admin (platform operator; no tenant). Idempotent.
  const email = (process.env.SUPERADMIN_EMAIL ?? 'admin@lifehub.local').toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD ?? 'ChangeMe123!';
  const [superRole] = await db.select().from(roles).where(eq(roles.key, ROLES.SUPER_ADMIN)).limit(1);
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!existing) {
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash: await bcrypt.hash(password, 12),
        fullName: 'Platform Administrator',
        status: 'ACTIVE',
        emailVerified: true,
      })
      .returning();
    await db.insert(userRoles).values({ userId: user.id, roleId: superRole.id });
    console.log(`Seeded Super Admin: ${user.email}`);
  } else {
    console.log(`Super Admin already exists: ${email}`);
  }

  // --- Phase 2: seed the document catalogue (idempotent) ---
  for (const t of CATALOGUE) {
    const [existing] = await db.select().from(documentTypes).where(eq(documentTypes.key, t.key)).limit(1);
    const values = {
      key: t.key, name: t.name, category: t.category, countries: t.countries,
      recommended: t.recommended, metadataSchema: publicSchema(t) as any, sort: t.sort,
    };
    if (existing) await db.update(documentTypes).set(values).where(eq(documentTypes.id, existing.id));
    else await db.insert(documentTypes).values(values);
  }
  console.log(`Seeded ${CATALOGUE.length} document types.`);

  // --- Internal tester account for alpha (tenant owner + is_internal_tester) ---
  const testerEmail = (process.env.TESTER_EMAIL ?? 'tester@lifehub.local').toLowerCase();
  const [ownerRole] = await db.select().from(roles).where(eq(roles.key, ROLES.TENANT_OWNER)).limit(1);
  const [existingTester] = await db.select().from(users).where(eq(users.email, testerEmail)).limit(1);
  if (!existingTester) {
    const [tenant] = await db.insert(tenants).values({ name: 'Internal Tester Household', type: 'HOUSEHOLD', status: 'TRIALING', country: 'GB' }).returning();
    const [tester] = await db
      .insert(users)
      .values({
        email: testerEmail,
        passwordHash: await bcrypt.hash(process.env.TESTER_PASSWORD ?? 'Tester123!', 12),
        fullName: 'Internal Tester',
        status: 'ACTIVE',
        emailVerified: true,
        isInternalTester: true,
        tenantId: tenant.id,
      })
      .returning();
    await db.insert(userRoles).values({ userId: tester.id, roleId: ownerRole.id });
    console.log(`Seeded internal tester: ${tester.email}`);
  } else {
    console.log(`Internal tester already exists: ${testerEmail}`);
  }

  // --- Phase 6: seed annual subscription plans + provision into Stripe (fake driver in dev) ---
  const { plans } = await import('./schema');
  const { provisionPlan } = await import('../lib/billing/service');
  const PLAN_SEED = [
    { key: 'starter', name: 'Starter', amount: 0, entitlements: { documents: 50, members: 1, aiAssistant: false, connectedServices: false }, sort: 10 },
    { key: 'family', name: 'Family', amount: 5900, entitlements: { documents: -1, members: 6, aiAssistant: true, connectedServices: false }, sort: 20 },
    { key: 'premium', name: 'Premium', amount: 9900, entitlements: { documents: -1, members: 6, aiAssistant: true, connectedServices: true }, sort: 30 },
  ];
  for (const p of PLAN_SEED) {
    const [existing] = await db.select().from(plans).where(eq(plans.key, p.key)).limit(1);
    if (existing) await db.update(plans).set({ name: p.name, amount: p.amount, entitlements: p.entitlements as any, sort: p.sort }).where(eq(plans.key, p.key));
    else await db.insert(plans).values({ key: p.key, name: p.name, amount: p.amount, entitlements: p.entitlements as any, sort: p.sort });
    await provisionPlan(p.key); // sets stripe product/price ids (fake in dev)
  }
  console.log(`Seeded ${PLAN_SEED.length} subscription plans.`);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
