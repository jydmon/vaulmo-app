/**
 * Family associations (FAM-02) + Privacy & Security Centre (SEC-16/17/18/19/20) smoke test.
 */
import { createApp } from '../src/app';
import { pool } from '../src/db/client';
const PORT = 4055; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j, headers: r.headers };
}
async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));
  const email = `pf+${Date.now()}@example.com`; const password = 'Privacy123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'PF User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const tok = login.j?.accessToken; ok('login', !!tok);

  // --- FAM-02: create a member, a document, assign, list member docs ---
  const mem = await api('POST', '/api/v1/family/members', tok, { name: 'Child One', relationship: 'child', isDependant: true });
  const memberId = mem.j?.member?.id ?? mem.j?.id; ok('member created', !!memberId, JSON.stringify(mem.j).slice(0, 80));
  const init = await api('POST', '/api/v1/vault/documents', tok, { filename: 'bc.txt', contentType: 'text/plain', sizeBytes: 40, title: "Child's birth certificate" });
  const docId = init.j?.documentId; ok('document created', !!docId);
  const assign = await api('POST', `/api/v1/vault/documents/${docId}/subject`, tok, { memberId });
  ok('assign document to member', assign.j?.subjectMemberId === memberId, JSON.stringify(assign.j));
  const memDocs = await api('GET', `/api/v1/family/members/${memberId}/documents`, tok);
  ok('member documents lists the assigned doc', (memDocs.j?.documents ?? []).some((d: any) => d.id === docId));
  const unassign = await api('POST', `/api/v1/vault/documents/${docId}/subject`, tok, { memberId: null });
  ok('can unassign (memberId null)', unassign.j?.subjectMemberId === null);
  const badAssign = await api('POST', `/api/v1/vault/documents/${docId}/subject`, tok, { memberId: '00000000-0000-0000-0000-000000000000' });
  ok('rejects unknown member', badAssign.status === 404);

  // --- SEC-17/21: security activity ---
  const act = await api('GET', '/api/v1/users/me/security-activity', tok);
  ok('security activity returns login events', Array.isArray(act.j?.activity) && act.j.activity.some((a: any) => a.action === 'auth.login.success'), JSON.stringify(act.j?.activity?.map((a: any) => a.action)).slice(0, 120));

  // --- SEC-20: consent ---
  const consent = await api('POST', '/api/v1/users/me/consent', tok, { policy: 'marketing', version: '2026-01' });
  ok('consent recorded', consent.status === 201 && consent.j?.consent?.policy === 'marketing');

  // --- SEC-16: privacy overview ---
  const priv = await api('GET', '/api/v1/users/me/privacy', tok);
  ok('privacy overview shows the consent', (priv.j?.consents ?? []).some((c: any) => c.policy === 'marketing'));

  // --- SEC-18: self-serve export ---
  const exp = await api('POST', '/api/v1/users/me/export', tok, {});
  ok('export returns a data bundle', !!exp.j?.account?.email && exp.j.account.email === email, JSON.stringify(Object.keys(exp.j ?? {})));
  ok('export includes the document metadata', (exp.j?.documents ?? []).some((d: any) => d.id === docId));
  ok('export attachment header set', (exp.headers.get('content-disposition') ?? '').includes('vaulmo-data-export'));
  const priv2 = await api('GET', '/api/v1/users/me/privacy', tok);
  ok('export logged as a completed DSR', (priv2.j?.requests ?? []).some((r: any) => r.type === 'export' && r.status === 'completed'));

  // --- SEC-19 + step-up: account-deletion request ---
  const wrongPw = await api('POST', '/api/v1/users/me/deletion-request', tok, { password: 'WrongPass123!' });
  ok('deletion needs correct password (step-up)', wrongPw.status === 403, `→ ${wrongPw.status}`);
  const del = await api('POST', '/api/v1/users/me/deletion-request', tok, { password, reason: 'No longer needed' });
  ok('deletion request created (pending, not executed)', del.status === 201 && del.j?.request?.status === 'pending', JSON.stringify(del.j));
  const dup = await api('POST', '/api/v1/users/me/deletion-request', tok, { password });
  ok('duplicate deletion request is de-duped', dup.j?.alreadyOpen === true);
  // Documents must still exist (SEC-15: request never auto-deletes data).
  const docsAfter = await api('GET', '/api/v1/vault/documents', tok);
  ok('data preserved after deletion request', (docsAfter.j?.documents ?? []).some((d: any) => d.id === docId));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
