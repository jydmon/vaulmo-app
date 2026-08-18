/**
 * Phase 7 (Family & Next-of-Kin) + Phase 8 (Emergency Access) end-to-end proof.
 * Proves family profiles/dependants, NOK nominate→invite→accept→reconfirm→revoke,
 * quarterly reconfirmation reminders, the "coming soon" flag, and the full emergency
 * workflow: request → owner decision → 7-day pending → super-admin security review +
 * due diligence → restricted temporary access → revocation → audit.
 */
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users, nextOfKin, emergencyRequests } from '../src/db/schema';

const PORT = 4015;
const base = `http://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const check = (n: string, c: boolean, d = '') => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n} ${d && '— ' + d}`)); };
async function api(method: string, url: string, o: { body?: unknown; token?: string; raw?: Buffer } = {}) {
  const h: Record<string, string> = {};
  if (o.token) h.authorization = `Bearer ${o.token}`;
  let body: string | Buffer | undefined;
  if (o.raw) { h['content-type'] = 'text/plain'; body = o.raw; }
  else if (o.body !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(o.body); }
  const res = await fetch(base + url, { method, headers: h, body });
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: res.status, json: j };
}
const login = async (e: string, p: string) => (await api('POST', '/api/v1/auth/login', { body: { email: e, password: p } })).json?.accessToken;

async function main() {
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));
  const sa = await login('admin@lifehub.local', 'ChangeMe123!');

  const ownerEmail = `owner+${Date.now()}@lifehub.local`;
  const reg = await api('POST', '/api/v1/auth/register', { body: { email: ownerEmail, password: 'Owner123456!', fullName: 'Account Owner' } });
  const tenantId = reg.json.user.tenantId;
  await db.update(users).set({ isInternalTester: true }).where(eq(users.id, reg.json.user.id));
  const owner = await login(ownerEmail, 'Owner123456!');

  // a document so emergency restricted-access has something to list
  const bytes = Buffer.from('UNITED KINGDOM\nPASSPORT\nPassport No: 546872331\nNationality: British\nDate of expiry: 22 Mar 2030');
  const initDoc = await api('POST', '/api/v1/vault/documents', { token: owner, body: { filename: 'passport.txt', contentType: 'text/plain', sizeBytes: bytes.length } });
  await api('PUT', initDoc.json.uploadUrl, { token: owner, raw: bytes });
  await api('POST', `/api/v1/vault/documents/${initDoc.json.documentId}/process`, { token: owner });
  await api('POST', `/api/v1/vault/documents/${initDoc.json.documentId}/confirm`, { token: owner, body: {} });

  console.log('\nPHASE 7 — FAMILY & DEPENDANTS');
  await api('POST', '/api/v1/family/members', { token: owner, body: { name: 'Emma', relationship: 'Child', isDependant: true, dateOfBirth: '2018-04-02' } });
  const members = await api('GET', '/api/v1/family/members', { token: owner });
  check('a dependant was added to the family', (members.json.members ?? []).some((m: any) => m.name === 'Emma' && m.isDependant));

  console.log('\nPHASE 7 — NEXT OF KIN (nominate → invite → accept)');
  const nokEmail = `rachel+${Date.now()}@example.com`;
  const nom = await api('POST', '/api/v1/family/nok', { token: owner, body: { name: 'Rachel Coles', email: nokEmail, relationship: 'Sister', permissions: { categories: ['passport'] } } });
  const nokId = nom.json.nok.id;
  check('next of kin nominated', nom.json.nok.status === 'nominated');
  const inv = await api('POST', `/api/v1/family/nok/${nokId}/invite`, { token: owner });
  check('invitation issues a token', !!inv.json.inviteToken);
  const accept = await api('POST', '/api/v1/nok/accept', { body: { token: inv.json.inviteToken } });
  check('NOK accepts the invitation (confirmed)', accept.json.status === 'confirmed');
  const nokList = await api('GET', '/api/v1/family/nok', { token: owner });
  check('confirmed NOK has a quarterly reconfirmation due date', !!nokList.json.nextOfKin.find((n: any) => n.id === nokId)?.reconfirmDueAt);

  console.log('\nPHASE 7 — QUARTERLY RECONFIRMATION REMINDER');
  await db.update(nextOfKin).set({ reconfirmDueAt: new Date(Date.now() - 86400000) }).where(eq(nextOfKin.id, nokId));
  const tick = await api('POST', '/api/v1/notifications/run-tick', { token: sa });
  check('reconfirmation reminder is generated when due', tick.json.nokReconfirmations >= 1, JSON.stringify(tick.json));
  const inbox = await api('GET', '/api/v1/notifications', { token: owner });
  check('owner is reminded to reconfirm the NOK', (inbox.json.notifications ?? []).some((n: any) => /reconfirm/i.test(n.title)));
  const recon = await api('POST', `/api/v1/family/nok/${nokId}/reconfirm`, { token: owner });
  check('owner can reconfirm the NOK', !!recon.json.nok.lastReconfirmedAt);

  console.log('\nPHASE 8 — "COMING SOON" (flag off)');
  delete process.env.EMERGENCY_ACCESS_ENABLED;
  const status0 = await api('GET', '/api/v1/emergency/status');
  check('emergency access shows as coming soon by default', status0.json.enabled === false);
  const blocked = await api('POST', '/api/v1/emergency/request', { body: { tenantId, requesterEmail: nokEmail } });
  check('emergency request blocked while coming soon (403)', blocked.status === 403 && blocked.json.error === 'coming_soon');

  console.log('\nPHASE 8 — EMERGENCY WORKFLOW (flag on)');
  process.env.EMERGENCY_ACCESS_ENABLED = 'true';
  const badReq = await api('POST', '/api/v1/emergency/request', { body: { tenantId, requesterEmail: 'stranger@example.com' } });
  check('a non-NOK cannot request emergency access (403)', badReq.status === 403);
  const request = await api('POST', '/api/v1/emergency/request', { body: { tenantId, requesterEmail: nokEmail, reason: 'Owner hospitalised' } });
  const erId = request.json.requestId;
  check('confirmed NOK can start a request (7-day pending)', request.status === 201 && !!request.json.pendingUntil);

  const decision = await api('POST', `/api/v1/emergency/requests/${erId}/owner-decision`, { token: owner, body: { decision: 'approve' } });
  check('owner can approve the request', decision.json.status === 'owner_approved');

  const early = await api('POST', `/api/v1/emergency/requests/${erId}/security-review`, { token: sa, body: { decision: 'approve' } });
  check('security review blocked until the 7-day period elapses (425)', early.status === 425, `status ${early.status}`);

  // simulate the pending period elapsing
  await db.update(emergencyRequests).set({ pendingUntil: new Date(Date.now() - 3600000) }).where(eq(emergencyRequests.id, erId));
  const ownerReview = await api('POST', `/api/v1/emergency/requests/${erId}/security-review`, { token: owner, body: { decision: 'approve' } });
  check('a non-super-admin cannot perform the security review (403)', ownerReview.status === 403);

  const review = await api('POST', `/api/v1/emergency/requests/${erId}/security-review`, { token: sa, body: { decision: 'approve', notes: 'ID verified', dueDiligence: { idChecked: true }, accessScope: { categories: ['passport'] }, accessDays: 3 } });
  check('super admin grants restricted, temporary access', review.json.status === 'active' && !!review.json.accessExpiresAt);

  const access = await api('GET', `/api/v1/emergency/access/${erId}?email=${encodeURIComponent(nokEmail)}`);
  check('granted requester sees a restricted view', Array.isArray(access.json.documents) && access.json.documents.length >= 1);
  check('restricted view exposes titles but NOT document contents', access.json.documents.every((d: any) => d.title && d.metadata === undefined && d.confirmedMetadata === undefined));

  console.log('\nPHASE 8 — REVOCATION');
  await api('POST', `/api/v1/emergency/requests/${erId}/revoke`, { token: owner });
  const afterRevoke = await api('GET', `/api/v1/emergency/access/${erId}?email=${encodeURIComponent(nokEmail)}`);
  check('access is denied after revocation', afterRevoke.status === 403);

  console.log('\nAUDIT + NOK REVOKE');
  const auditLog = await api('GET', '/api/v1/admin/audit?limit=300', { token: sa });
  const actions = (auditLog.json.logs ?? []).map((l: any) => l.action);
  check('emergency request + grant + revoke are all audited', ['emergency.requested', 'emergency.security.approved', 'emergency.revoked'].every((a) => actions.includes(a)));
  await api('POST', `/api/v1/family/nok/${nokId}/revoke`, { token: owner });
  const nokAfter = await api('GET', '/api/v1/family/nok', { token: owner });
  check('a next of kin can be revoked', nokAfter.json.nextOfKin.find((n: any) => n.id === nokId)?.status === 'revoked');

  server.close();
  await pool.end();
  console.log(`\n${'='.repeat(48)}\n  RESULT: ${passed} passed, ${failed} failed\n${'='.repeat(48)}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
