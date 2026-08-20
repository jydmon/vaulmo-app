/**
 * Onboarding & gating flow smoke test.
 * Journey: register → (email verify) → accept Terms of Business → select plan → tour.
 * Proves the onboarding state on /me flips correctly at each step.
 */
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
import { CURRENT_TERMS_VERSION } from '../src/lib/legal';
const PORT = 4099; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j };
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  // Legal docs are public (shown before/after sign-in).
  const legal = await api('GET', '/api/v1/legal');
  ok('legal documents are public', legal.status === 200 && (legal.j?.documents ?? []).some((d: any) => d.key === 'terms_of_business'));
  const tob = await api('GET', '/api/v1/legal/terms_of_business');
  ok('terms of business has content + version', !!tob.j?.document?.body && tob.j.document.version === CURRENT_TERMS_VERSION);

  const email = `onb+${Date.now()}@example.com`; const password = 'Onboard123!';
  const reg = await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Onboarding User' });
  const tok = reg.j?.accessToken; ok('register returns a session', !!tok);

  // Fresh account: email not verified, terms not accepted, no plan, tour not seen.
  let me = await api('GET', '/api/v1/users/me', tok);
  ok('new user: email not verified', me.j?.onboarding?.emailVerified === false);
  ok('new user: terms not accepted', me.j?.onboarding?.termsAccepted === false);
  ok('new user: no plan selected', me.j?.onboarding?.planSelected === false);
  ok('new user: onboarding NOT complete', me.j?.onboarding?.complete === false);

  // Verify email (dev token path).
  const rv = await api('POST', '/api/v1/auth/request-verification', tok, {});
  if (rv.j?.devToken) await api('POST', '/api/v1/auth/verify-email', tok, { token: rv.j.devToken });
  me = await api('GET', '/api/v1/users/me', tok);
  ok('after verify: email verified', me.j?.onboarding?.emailVerified === true);

  // Accept Terms of Business.
  const at = await api('POST', '/api/v1/users/me/accept-terms', tok, {});
  ok('accept-terms flips termsAccepted', at.j?.onboarding?.termsAccepted === true, JSON.stringify(at.j?.onboarding));

  // Select the free Starter plan → activates immediately.
  const choose = await api('POST', '/api/v1/billing/choose', tok, { planKey: 'starter' });
  ok('choose free plan activates', choose.j?.mode === 'activated', JSON.stringify(choose.j));
  me = await api('GET', '/api/v1/users/me', tok);
  ok('after plan: planSelected true', me.j?.onboarding?.planSelected === true);
  ok('onboarding now complete (email+terms+plan)', me.j?.onboarding?.complete === true, JSON.stringify(me.j?.onboarding));

  // Choosing a paid plan in the fake-gateway phase also activates (so the journey completes now).
  const paid = await api('POST', '/api/v1/billing/choose', tok, { planKey: 'family' });
  ok('paid plan activates in fake-gateway phase', paid.j?.mode === 'activated' && paid.j?.subscription?.planKey === 'family');

  // Tour seen.
  ok('tour not seen yet', me.j?.onboarding?.tourSeen === false);
  await api('POST', '/api/v1/users/me/tour-seen', tok, {});
  me = await api('GET', '/api/v1/users/me', tok);
  ok('tour-seen flips tourSeen', me.j?.onboarding?.tourSeen === true);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
