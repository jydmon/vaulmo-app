/**
 * Plan modules + discounts + subscription-based feature gating smoke test.
 */
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users, subscriptions, tenants, plans } from '../src/db/schema';
const PORT = 4102; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function adminSession(): Promise<string> {
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.email, 'admin@lifehub.local'));
  const l = await api('POST', '/api/v1/auth/login', undefined, { email: 'admin@lifehub.local', password: 'ChangeMe123!' });
  let tok = l.j?.accessToken;
  const enroll = await api('POST', '/api/v1/mfa/enroll', tok, {});
  const conf = await api('POST', '/api/v1/mfa/confirm', tok, { code: authenticator.generate(enroll.j.secret) });
  return conf.j?.accessToken ?? tok;
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  const email = `plan+${Date.now()}@example.com`; const password = 'PlanUser123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Plan User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const utok = login.j?.accessToken; const tenantId = login.j?.user?.tenantId as string;
  ok('user login', !!utok && !!tenantId);

  // Baseline (starter, no plan modules curated) → permissive: family access works.
  const famBase = await api('GET', '/api/v1/family/members', utok);
  ok('starter user CAN access family (permissive default)', famBase.status === 200, `→ ${famBase.status}`);

  // Admin creates a restricted plan: vault+reminders only, £50 with 20% off.
  const tok = await adminSession();
  const up = await api('POST', '/api/v1/billing/admin/plans', tok, { key: 'restricted', name: 'Restricted', amount: 5000, modules: ['vault', 'reminders'], discountPercent: 20, discountLabel: 'Launch offer', entitlements: { members: 2 } });
  ok('admin upserts a plan with modules + discount', up.status === 200 || up.status === 201, `→ ${up.status}`);

  // Public plans listing reflects modules + discounted net price.
  const plansList = await api('GET', '/api/v1/billing/plans', utok);
  const rp = (plansList.j?.plans ?? []).find((p: any) => p.key === 'restricted');
  ok('plans listing exposes the module registry', (plansList.j?.modules ?? []).some((m: any) => m.key === 'assistant'));
  ok('restricted plan shows its modules', !!rp && rp.modules.includes('vault') && !rp.modules.includes('family'), JSON.stringify(rp?.modules));
  ok('discount applied to net price (5000 - 20% = 4000)', rp?.netAmount === 4000 && rp?.discountPercent === 20, JSON.stringify({ n: rp?.netAmount, d: rp?.discountPercent }));

  // Put the user on the restricted plan.
  await db.insert(subscriptions).values({ tenantId, planKey: 'restricted', status: 'active', currentPeriodEnd: new Date(Date.now() + 300 * 86400000), cancelAtPeriodEnd: false })
    .onConflictDoUpdate({ target: subscriptions.tenantId, set: { planKey: 'restricted', status: 'active' } });
  await db.update(tenants).set({ plan: 'restricted' }).where(eq(tenants.id, tenantId));

  // Entitlements now report the restricted module set.
  const ent = await api('GET', '/api/v1/billing/entitlements', utok);
  ok('entitlements report restricted modules', (ent.j?.modules ?? []).includes('vault') && !(ent.j?.modules ?? []).includes('assistant'), JSON.stringify(ent.j?.modules));

  // Gated features are now blocked (402), included ones still work.
  const fam = await api('GET', '/api/v1/family/members', utok);
  ok('family is blocked on restricted plan (402)', fam.status === 402, `→ ${fam.status}`);
  const assets = await api('GET', '/api/v1/assets', utok);
  ok('assets is blocked on restricted plan (402)', assets.status === 402, `→ ${assets.status}`);
  const ask = await api('POST', '/api/v1/assistant/ask', utok, { question: 'hello' });
  ok('assistant is blocked on restricted plan (402)', ask.status === 402, `→ ${ask.status}`);
  const vault = await api('GET', '/api/v1/vault/documents', utok);
  ok('vault (included module) still works', vault.status === 200, `→ ${vault.status}`);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
