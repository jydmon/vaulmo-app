/**
 * Assets (Properties & Vehicles) smoke test — FAM-04/05.
 * Proves: create asset, auto renewal reminders, link a document, per-asset docs,
 * update re-syncs reminders, delete clears them.
 */
import { and, eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { reminders } from '../src/db/schema';
const PORT = 4066; const base = `http://127.0.0.1:${PORT}`;
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
  const email = `as+${Date.now()}@example.com`; const password = 'Assets123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Asset User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const tok = login.j?.accessToken; const tenantId = login.j?.user?.tenantId as string; ok('login', !!tok);

  // Create a vehicle with an MOT date → should auto-create a renewal reminder.
  const veh = await api('POST', '/api/v1/assets', tok, { kind: 'vehicle', name: 'VW Golf', details: { registration: 'AB12 CDE', motDate: '2027-03-01', insuranceDate: '2026-11-01' } });
  const vehId = veh.j?.asset?.id; ok('vehicle created', !!vehId, JSON.stringify(veh.j).slice(0, 80));
  const rems1 = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.kind, 'asset_renewal')));
  ok('MOT + insurance renewal reminders auto-created', rems1.filter((r) => r.title.startsWith('VW Golf')).length === 2, JSON.stringify(rems1.map((r) => r.title)));

  // Property with insurance date.
  const prop = await api('POST', '/api/v1/assets', tok, { kind: 'property', name: '12 Oak St', details: { address: '12 Oak Street', insuranceDate: '2026-12-15' } });
  ok('property created', !!prop.j?.asset?.id);

  // List + filter by kind.
  const listV = await api('GET', '/api/v1/assets?kind=vehicle', tok);
  ok('list filters by kind', (listV.j?.assets ?? []).length === 1 && listV.j.assets[0].kind === 'vehicle');
  const listAll = await api('GET', '/api/v1/assets', tok);
  ok('list returns both assets', (listAll.j?.assets ?? []).length === 2);

  // Link a document to the vehicle.
  const init = await api('POST', '/api/v1/vault/documents', tok, { filename: 'ins.txt', contentType: 'text/plain', sizeBytes: 30, title: 'Car insurance policy' });
  const docId = init.j?.documentId;
  const link = await api('POST', `/api/v1/vault/documents/${docId}/asset`, tok, { assetId: vehId });
  ok('document linked to asset', link.j?.assetId === vehId, JSON.stringify(link.j));
  const detail = await api('GET', `/api/v1/assets/${vehId}`, tok);
  ok('asset detail lists its documents', (detail.j?.documents ?? []).some((d: any) => d.id === docId));
  const badLink = await api('POST', `/api/v1/vault/documents/${docId}/asset`, tok, { assetId: '00000000-0000-0000-0000-000000000000' });
  ok('rejects unknown asset', badLink.status === 404);

  // Update the MOT date → reminder re-syncs to the new date.
  await api('PATCH', `/api/v1/assets/${vehId}`, tok, { details: { registration: 'AB12 CDE', motDate: '2028-03-01', insuranceDate: '2026-11-01' } });
  const rems2 = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.kind, 'asset_renewal')));
  const mot = rems2.find((r) => r.title === 'VW Golf — MOT renewal');
  ok('MOT reminder re-synced to new date', mot?.dueDate === '2028-03-01', mot?.dueDate ?? '');
  ok('still exactly 2 vehicle reminders (no duplicates)', rems2.filter((r) => r.title.startsWith('VW Golf')).length === 2);

  // Delete the vehicle → its renewal reminders are cleared.
  const del = await api('DELETE', `/api/v1/assets/${vehId}`, tok);
  ok('asset deleted', del.j?.deleted === true);
  const rems3 = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.kind, 'asset_renewal')));
  ok('vehicle renewal reminders cleared on delete', rems3.filter((r) => r.title.startsWith('VW Golf')).length === 0);

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
