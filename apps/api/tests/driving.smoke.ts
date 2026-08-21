/** Driving-charge zones + alerts + admin editor smoke test. */
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';
const PORT = 4113; const base = `http://127.0.0.1:${PORT}`;
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

  const email = `driver+${Date.now()}@example.com`;
  const reg = await api('POST', '/api/v1/auth/register', undefined, { email, password: 'Driver12345!', fullName: 'Dana Driver' });
  const tok = reg.j?.accessToken ?? (await api('POST', '/api/v1/auth/login', undefined, { email, password: 'Driver12345!' })).j?.accessToken;
  ok('driver session', !!tok);

  const noauth = await api('GET', '/api/v1/driving/zones');
  ok('zones require auth (401)', noauth.status === 401, `→ ${noauth.status}`);

  // Zone catalogue seeds on first read; nearest-first when a location is given.
  const zonesLondon = await api('GET', '/api/v1/driving/zones?lat=51.5074&lng=-0.1278&limit=5', tok);
  const zl = zonesLondon.j?.zones ?? [];
  ok('zones seed + return catalogue', zl.length === 5 && zl.every((z: any) => typeof z.amount === 'number'));
  ok('nearest zone to London is London ULEZ/CC', /london/i.test(zl[0]?.name ?? '') && typeof zl[0]?.distanceKm === 'number', zl[0]?.name);
  const allZones = await api('GET', '/api/v1/driving/zones', tok);
  ok('catalogue covers UK + abroad', (allZones.j?.zones ?? []).some((z: any) => z.country === 'GB') && (allZones.j.zones).some((z: any) => z.country !== 'GB') && allZones.j.zones.length >= 15, `→ ${allZones.j?.zones?.length}`);
  const ulez = (allZones.j.zones).find((z: any) => z.key === 'uk_london_ulez');
  ok('ULEZ is compliant-free at £12.50/day', ulez && ulez.compliantFree === true && ulez.amount === 1250 && ulez.unit === 'day');
  const cc = (allZones.j.zones).find((z: any) => z.key === 'uk_london_cc');
  ok('Congestion Charge charges every car (£15)', cc && cc.compliantFree === false && cc.amount === 1500);

  // Vehicle compliance is stored on the vehicle asset.
  const veh = await api('POST', '/api/v1/assets', tok, { kind: 'vehicle', name: 'VW Golf', details: { registration: 'AB21 CDE' } });
  const vid = veh.j?.asset?.id; ok('vehicle created', !!vid);
  const before = await api('GET', '/api/v1/driving/vehicles', tok);
  ok('vehicle listed (compliance unset)', (before.j?.vehicles ?? []).some((v: any) => v.id === vid && v.compliant === null));
  const patch = await api('PATCH', `/api/v1/driving/vehicles/${vid}`, tok, { fuelType: 'diesel', compliant: true });
  ok('vehicle compliance saved', patch.j?.vehicle?.compliant === true && patch.j.vehicle.fuelType === 'diesel');

  // Alerts are logged + listed.
  const a = await api('POST', '/api/v1/driving/alert', tok, { zoneKey: 'uk_london_cc', zoneName: 'London Congestion Charge', vehicleLabel: 'VW Golf (AB21 CDE)', amount: 1500, currency: 'GBP' });
  ok('alert logged (201)', a.status === 201);
  const list = await api('GET', '/api/v1/driving/alerts', tok);
  ok('alert history returned', (list.j?.alerts ?? []).some((x: any) => x.zoneKey === 'uk_london_cc' && x.amount === 1500));

  // ---- Admin zone editor ----
  const denied = await api('GET', '/api/v1/admin/driving/zones', tok);
  ok('non-admin cannot manage zones (403)', denied.status === 403, `→ ${denied.status}`);

  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.email, 'admin@lifehub.local'));
  const al = await api('POST', '/api/v1/auth/login', undefined, { email: 'admin@lifehub.local', password: 'ChangeMe123!' });
  let atok = al.j?.accessToken;
  const enroll = await api('POST', '/api/v1/mfa/enroll', atok, {});
  atok = (await api('POST', '/api/v1/mfa/confirm', atok, { code: authenticator.generate(enroll.j.secret) })).j?.accessToken ?? atok;

  const adminList = await api('GET', '/api/v1/admin/driving/zones', atok);
  ok('admin lists all zones', adminList.status === 200 && (adminList.j?.zones ?? []).length >= 15);

  // Create a time-limited no-parking zone.
  const npKey = `np_test_${Date.now()}`;
  const create = await api('POST', '/api/v1/admin/driving/zones', atok, { key: npKey, name: 'Test High St (no parking)', country: 'GB', type: 'noparking', lat: 51.6, lng: -0.2, radiusM: 300, amount: 7000, currency: 'GBP', unit: 'day', compliantFree: false, schedule: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:30' }, active: true });
  ok('admin creates a no-parking zone with a schedule', create.status === 201 && create.j?.zone?.type === 'noparking' && create.j.zone.schedule?.start === '08:00');

  // A driver sees it (with the schedule) so the app can compute “free from …”.
  const drv = await api('GET', '/api/v1/driving/zones', tok);
  const np = (drv.j?.zones ?? []).find((z: any) => z.key === npKey);
  ok('no-parking zone reaches the app with its schedule', !!np && np.schedule?.end === '18:30' && np.type === 'noparking');

  // Edit amount, then delete.
  const upd = await api('PATCH', `/api/v1/admin/driving/zones/${create.j.zone.id}`, atok, { amount: 8000 });
  ok('admin edits a zone', upd.j?.zone?.amount === 8000);
  const delz = await api('DELETE', `/api/v1/admin/driving/zones/${create.j.zone.id}`, atok);
  ok('admin deletes a zone', delz.j?.deleted === true);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
