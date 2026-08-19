/**
 * Account & Onboarding smoke test (Increment 3).
 * Proves: profile update (ACC-07), personalised onboarding questionnaire (ACC-09),
 * tailored checklist recommendations, per-document decisions (ACC-11) with score
 * exclusion, and "remind me" reminder creation (ACC-13).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { auditLogs, reminders } from '../src/db/schema';

const PORT = 4022;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d}`)); };

async function api(method: string, url: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(base + url, { method, headers, body });
  const text = await res.text();
  let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  const email = `onb+${Date.now()}@example.com`;
  await api('POST', '/api/v1/auth/register', { body: { email, password: 'Onboard123!', fullName: 'Onboard User' } });
  const login = await api('POST', '/api/v1/auth/login', { body: { email, password: 'Onboard123!' } });
  const token = login.json?.accessToken;
  const tenantId = login.json?.user?.tenantId ?? null;
  check('regular user logs in with a full session', !!token);

  // --- ACC-07 profile: name, phone, timezone, country ---
  const put = await api('PUT', '/api/v1/users/me', { token, body: { fullName: 'Onboard Renamed', phone: '+44 7700 900123', timezone: 'Europe/London', country: 'gb' } });
  check('profile update returns phone', put.json?.phone === '+44 7700 900123', put.json?.phone);
  check('profile update returns timezone', put.json?.timezone === 'Europe/London', put.json?.timezone);
  check('country stored uppercased on the household', put.json?.tenant?.country === 'GB', put.json?.tenant?.country);
  const me = await api('GET', '/api/v1/users/me', { token });
  check('GET /me reflects saved profile', me.json?.fullName === 'Onboard Renamed' && me.json?.phone === '+44 7700 900123');

  // --- ACC-09 onboarding: questions available, not yet completed ---
  const onb0 = await api('GET', '/api/v1/vault/onboarding', { token });
  check('onboarding exposes the questionnaire', Array.isArray(onb0.json?.questions) && onb0.json.questions.length >= 4);
  check('onboarding starts incomplete', onb0.json?.completed === false);

  // Baseline checklist (before onboarding) — country default recommendations for GB.
  const cl0 = await api('GET', '/api/v1/vault/checklist', { token });
  const keys0 = new Set((cl0.json?.items ?? []).map((i: any) => i.key));
  check('pre-onboarding checklist is the country default', cl0.json?.onboardingCompleted === false && keys0.has('passport'));

  // --- Complete onboarding: no vehicle, no children, renting ---
  const save = await api('POST', '/api/v1/vault/onboarding', { token, body: { answers: { home: 'rent', vehicle: false, children: false, travel: true } } });
  check('onboarding save marks completed', save.json?.onboarding?.completed === true);

  const cl1 = await api('GET', '/api/v1/vault/checklist', { token });
  const keys1 = new Set((cl1.json?.items ?? []).map((i: any) => i.key));
  check('tailored checklist marks onboarding complete', cl1.json?.onboardingCompleted === true);
  check('renter → tenancy_agreement recommended', keys1.has('tenancy_agreement'), [...keys1].join(','));
  check('no vehicle → MOT excluded from checklist', !keys1.has('vehicle_mot'), [...keys1].join(','));
  check('no children → birth_certificate excluded from checklist', !keys1.has('birth_certificate'), [...keys1].join(','));

  // --- ACC-11 per-document decision: mark passport not_applicable → excluded from score ---
  const scoreBefore = cl1.json?.completionScore;
  const totalBefore = cl1.json?.total;
  const dec = await api('POST', '/api/v1/vault/checklist/decision', { token, body: { typeKey: 'passport', decision: 'not_applicable' } });
  check('decision endpoint accepts not_applicable', dec.json?.decision === 'not_applicable');
  const cl2 = await api('GET', '/api/v1/vault/checklist', { token });
  check('not_applicable removes item from counted total', cl2.json?.total === totalBefore - 1, `${totalBefore} -> ${cl2.json?.total}`);
  const passportItem = (cl2.json?.items ?? []).find((i: any) => i.key === 'passport');
  check('checklist still shows the item with its decision', passportItem?.decision === 'not_applicable');
  check('not_applicable item is not in outstanding', !(cl2.json?.outstanding ?? []).some((i: any) => i.key === 'passport'));

  // --- ACC-13 remind me: creates an ACTIVE "Obtain" reminder ---
  const rem = await api('POST', '/api/v1/vault/checklist/decision', { token, body: { typeKey: 'will', decision: 'remind_me' } });
  check('remind_me returns a reminder id', !!rem.json?.reminderId, JSON.stringify(rem.json));
  const remRows = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.title, 'Obtain Last Will & Testament')));
  check('an ACTIVE obtain reminder exists', remRows.some((r) => r.status === 'ACTIVE' && r.kind === 'obtain'), JSON.stringify(remRows.map((r) => r.status)));

  // Changing the decision away from remind_me clears the obtain reminder.
  await api('POST', '/api/v1/vault/checklist/decision', { token, body: { typeKey: 'will', decision: 'not_applicable' } });
  const remRows2 = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.title, 'Obtain Last Will & Testament')));
  check('changing decision clears the obtain reminder', remRows2.length === 0, JSON.stringify(remRows2.map((r) => r.status)));

  // --- audit trail ---
  const events = await db.select().from(auditLogs).where(inArray(auditLogs.action, ['user.profile.updated', 'onboarding.completed', 'document.decision'])).orderBy(desc(auditLogs.at)).limit(50);
  const actions = new Set(events.map((e) => e.action));
  check('profile + onboarding + decision audited', actions.has('user.profile.updated') && actions.has('onboarding.completed') && actions.has('document.decision'), [...actions].join(','));

  console.log(`\n  RESULT: ${passed} passed, ${failed} failed\n`);
  server.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
