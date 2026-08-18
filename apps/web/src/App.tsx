import { useEffect, useState, Fragment } from 'react';
import { api, setTokens, uploadText, ApiError, type AuthResult } from './api';

/* ---------------- helpers ---------------- */
function useToast() {
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2400); return () => clearTimeout(t); }, [msg]);
  const node = <div className={`toast ${msg ? 'show' : ''}`}>{msg}</div>;
  return { toast: setMsg, node };
}
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const CATICON: Record<string, string> = { Identity: '🪪', Insurance: '🛡️', Vehicle: '🚗', Property: '🏠', Warranties: '⭐', Legal: '⚖️', Travel: '✈️', Health: '❤️', Finance: '💳' };
const ICONS: Record<string, string> = {
  home: 'M4 11l8-6 8 6M6 10v9h12v-9', vault: 'M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM4 9h16M12 13v2',
  assistant: 'M12 3a9 9 0 00-9 9c0 1.6.4 3 1.1 4.3L3 21l4.8-1.1A9 9 0 1012 3z', reminders: 'M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6zM10 20a2 2 0 004 0',
  trips: 'M3 15l18-6-4 9-3-3-4 2zM14 11l-4 4', purchases: 'M6 7h12l1 13H5zM9 7a3 3 0 016 0', subs: 'M4 12a8 8 0 018-8 8 8 0 016 2.7M20 12a8 8 0 01-8 8 8 8 0 01-6-2.7M19 4v4h-4M5 20v-4h4',
  connected: 'M9 7l-2 2a4 4 0 000 6l2 2M15 7l2 2a4 4 0 010 6l-2 2M9 12h6', family: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5M17 11a3 3 0 000-6M21 20c0-2.4-1.6-4-4-4.4',
  billing: 'M3 7h18v11H3zM3 10h18M7 15h4', settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1.5-2-3.4-2.3 1a7 7 0 00-2.3-1.3L14 4h-4l-.3 2.8a7 7 0 00-2.3 1.3l-2.3-1-2 3.4L3 12l-2 1.5 2 3.4 2.3-1a7 7 0 002.3 1.3L10 20h4l.3-2.8a7 7 0 002.3-1.3l2.3 1 2-3.4z',
  overview: 'M4 13h7V4H4zM13 20h7v-9h-7zM4 20h7v-4H4zM13 4v5h7V4z', tenants: 'M4 20V8l6-4 6 4v12M4 20h12M14 11h3v9', users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5M17 11a3 3 0 000-6M21 20c0-2.4-1.6-4-4-4.4', audit: 'M7 4h10v16H7zM10 8h4M10 12h4M10 16h2',
};
const Icon = ({ k, size = 20 }: { k: string; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[k] ?? ICONS.home} /></svg>;

/* ---------------- root ---------------- */
export function App() {
  const [me, setMe] = useState<any>(null);
  const [view, setView] = useState<'login' | 'register' | 'mfa'>('login');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function afterAuth(r: AuthResult) {
    if (r.mfaRequired && r.challengeToken) { setChallenge(r.challengeToken); setView('mfa'); return; }
    if (r.accessToken && r.refreshToken) { setTokens(r.accessToken, r.refreshToken); setMe(await api.me()); }
  }
  if (me) return <Shell me={me} onSignOut={() => { setTokens(null, null); setMe(null); setView('login'); }} />;

  return (
    <div className="auth-wrap">
      <div>
        <div className="brandmark"><div className="logo">LH</div><div><b>Vaulmo</b><span>Your life, organised</span></div></div>
        {error && <div className="err" style={{ width: 400, maxWidth: '92vw' }}>{error}</div>}
        {view === 'login' && <AuthForm title="Sign in" fields={['email', 'password']} cta="Sign in"
          onSubmit={async (v) => { setError(''); try { await afterAuth(await api.login(v)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } }}
          foot={<>New here? <a onClick={() => { setError(''); setView('register'); }}>Create an account</a></>} />}
        {view === 'register' && <AuthForm title="Create your household" fields={['fullName', 'email', 'password']} cta="Create account"
          onSubmit={async (v) => { setError(''); try { await afterAuth(await api.register(v)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Failed'); } }}
          foot={<>Have an account? <a onClick={() => { setError(''); setView('login'); }}>Sign in</a></>} />}
        {view === 'mfa' && <MfaForm onSubmit={async (code) => { setError(''); try { await afterAuth(await api.loginMfa(code, challenge!)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Invalid code'); } }} />}
      </div>
    </div>
  );
}

function AuthForm(props: { title: string; fields: string[]; cta: string; onSubmit: (v: any) => void; foot: React.ReactNode }) {
  const [v, setV] = useState<any>({ fullName: '', email: '', password: '' });
  const lbl: any = { fullName: 'Full name', email: 'Email', password: 'Password' };
  return <form className="card auth-card" onSubmit={(e) => { e.preventDefault(); props.onSubmit(v); }}>
    <h1>{props.title}</h1>
    {props.fields.map((f) => <label key={f}>{lbl[f]}<input type={f === 'password' ? 'password' : f === 'email' ? 'email' : 'text'} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} required /></label>)}
    <button className="btn block" type="submit">{props.cta}</button>
    <div className="foot">{props.foot}</div>
  </form>;
}
function MfaForm(props: { onSubmit: (c: string) => void }) {
  const [c, setC] = useState('');
  return <form className="card auth-card" onSubmit={(e) => { e.preventDefault(); props.onSubmit(c); }}>
    <h1>Two-factor authentication</h1><p className="muted">Enter the 6-digit code from your authenticator app.</p>
    <label>Code<input value={c} onChange={(e) => setC(e.target.value)} placeholder="123456" required /></label>
    <button className="btn block" type="submit">Verify</button>
  </form>;
}

/* ---------------- shell ---------------- */
const TENANT_NAV = [
  { grp: 'Vaulmo' }, { id: 'home', label: 'Home', ic: 'home' }, { id: 'vault', label: 'My Vault', ic: 'vault' },
  { id: 'assistant', label: 'Ask Vaulmo', ic: 'assistant' }, { id: 'reminders', label: 'Reminders', ic: 'reminders' },
  { grp: 'Life' }, { id: 'trips', label: 'Trips', ic: 'trips' }, { id: 'purchases', label: 'Purchases', ic: 'purchases' },
  { id: 'subs', label: 'Subscriptions', ic: 'subs' }, { id: 'connected', label: 'Connected', ic: 'connected' },
  { grp: 'Account' }, { id: 'family', label: 'Family & Access', ic: 'family' }, { id: 'billing', label: 'Plan & Billing', ic: 'billing' }, { id: 'settings', label: 'Settings', ic: 'settings' },
];
const ADMIN_NAV = [{ grp: 'Platform' }, { id: 'home', label: 'Overview', ic: 'overview' }, { id: 'customers', label: 'Customers', ic: 'tenants' }, { id: 'subscriptions', label: 'Subscriptions', ic: 'billing' }, { id: 'audit', label: 'Audit', ic: 'audit' }];

function Shell({ me, onSignOut }: { me: any; onSignOut: () => void }) {
  const isSuper = me?.roles?.includes('super_admin');
  const nav = isSuper ? ADMIN_NAV : TENANT_NAV;
  const [active, setActive] = useState(isSuper ? 'home' : 'home');
  const [unread, setUnread] = useState(0);
  const { toast, node } = useToast();
  useEffect(() => { if (!isSuper) api.unread().then((r) => setUnread(r.unread)).catch(() => {}); }, [active, isSuper]);

  const titles: any = {
    home: isSuper ? ['Platform Overview', 'Every tenant at a glance'] : [`Hi, ${me.fullName.split(' ')[0]}`, "Here's what matters today"],
    vault: ['My Vault', 'Your important documents'], assistant: ['Ask Vaulmo', 'Answers from your own vault'],
    reminders: ['Reminders', 'What needs your attention'], trips: ['Trips', 'Your travel, organised'],
    purchases: ['Purchases & Warranties', 'Receipts, assets and warranties'], subs: ['Subscriptions', 'What you pay for'],
    connected: ['Connected Services', 'Import from email automatically'], family: ['Family & Access', 'People, next of kin, emergency access'],
    billing: ['Plan & Billing', 'Your Vaulmo subscription'], settings: ['Settings', 'Security & preferences'], customers: ['Customers', 'Accounts & the people in them'], subscriptions: ['Subscriptions', 'Plans, status & revenue'], audit: ['Audit Log', 'Platform activity'],
  };
  const [t0, t1] = titles[active] ?? ['', ''];
  const views: any = { home: isSuper ? <AdminHome /> : <Home me={me} go={setActive} />, vault: <Vault toast={toast} />, assistant: <Assistant />, reminders: <Reminders onRead={() => api.unread().then((r) => setUnread(r.unread))} />, trips: <Trips />, purchases: <Purchases />, subs: <Subs toast={toast} />, connected: <Connected toast={toast} />, family: <Family toast={toast} />, billing: <Billing toast={toast} />, settings: <Settings me={me} toast={toast} />, customers: <Customers toast={toast} />, subscriptions: <Subscriptions toast={toast} />, audit: <Audit /> };

  return <div className="app">
    <aside className="sidebar">
      <div className="sb-brand"><div className="logo">LH</div><div><b>Vaulmo</b><span>{isSuper ? 'Admin' : 'Family Vault'}</span></div></div>
      <nav className="nav">{nav.map((n: any, i) => n.grp ? <div className="grp" key={i}>{n.grp}</div> :
        <button key={n.id} className={active === n.id ? 'on' : ''} onClick={() => setActive(n.id)}><Icon k={n.ic} />{n.label}{n.id === 'reminders' && unread > 0 && <span className="dot">{unread}</span>}</button>)}
      </nav>
      <div className="sb-foot"><div className="av">{me.fullName.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</div><div><div className="nm">{me.fullName}</div><div className="rl">{isSuper ? 'Super Admin' : me.tenant?.name ?? 'Member'}</div></div></div>
    </aside>
    <main className="main">
      <div className="top"><div><h2>{t0}</h2><div className="sub">{t1}</div></div>
        <div className="sp">{!isSuper && <button className="bell" onClick={() => setActive('reminders')}>🔔{unread > 0 && <span className="dot">{unread}</span>}</button>}<button className="btn sec sm" onClick={onSignOut}>Sign out</button></div>
      </div>
      <div className="view" key={active}>{views[active]}</div>
    </main>
    {node}
  </div>;
}

/* ---------------- data hook ---------------- */
function useData<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const reload = () => fn().then(setData).catch((e) => setErr(e instanceof ApiError ? e.message : 'Error'));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, reload };
}
const Tile = ({ ic, bg, lab, val, note }: any) => <div className="tile"><div className="lab"><span className="ic" style={{ background: bg }}>{ic}</span>{lab}</div><div className="val">{val}</div>{note && <div className="note">{note}</div>}</div>;
const Card = ({ title, right, children }: any) => <div className="card"><div className="card-h"><h3>{title}</h3>{right && <span className="r">{right}</span>}</div><div className="card-b">{children}</div></div>;
function remPill(r: any) { const d = r.dueDate ? Math.round((+new Date(r.dueDate) - Date.now()) / 86400000) : null; const cls = d == null ? 'p-neutral' : d < 0 ? 'p-crit' : d <= 7 ? 'p-crit' : d <= 30 ? 'p-warn' : 'p-good'; return <span className={`pill ${cls}`}>{d == null ? 'on file' : d < 0 ? `${-d}d overdue` : `in ${d}d`}</span>; }

/* ---------------- tenant views ---------------- */
function Home({ me, go }: any) {
  const { data: cl } = useData(() => api.checklist());
  const { data: brief } = useData(() => api.whatsImportant());
  const { data: rem } = useData(() => api.reminders());
  const up = (rem?.live ?? []).slice().sort((a: any, b: any) => (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1);
  return <>
    <div className="tiles">
      <Tile ic="✅" bg="var(--good-bg)" lab="Vaulmo completion" val={`${cl?.completionScore ?? 0}%`} note={`${cl?.confirmed ?? 0} confirmed`} />
      <Tile ic="🔔" bg="var(--warn-bg)" lab="Live reminders" val={rem?.live?.length ?? 0} note="upcoming dates" />
      <Tile ic="📄" bg="var(--brand-soft)" lab="Outstanding docs" val={cl?.outstanding?.length ?? 0} note="recommended" />
      <Tile ic="💳" bg="var(--violet-bg)" lab="Plan" val={me.tenant?.plan ?? 'starter'} note={me.tenant?.status ?? ''} />
    </div>
    <div className="grid2">
      <Card title="What you need to know">
        <p style={{ margin: '2px 0 12px' }}>{brief?.summary ?? '…'}</p>
        {up.slice(0, 6).map((r: any) => <div className="row" key={r.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>🔔</div><div className="m"><div className="t">{r.title}</div><div className="s">{fmt(r.dueDate)}</div></div>{remPill(r)}</div>)}
        {!up.length && <div className="empty">Nothing scheduled yet.</div>}
      </Card>
      <Card title="Get started" right={<a onClick={() => go('vault')}>Open vault →</a>}>
        <div className="row" onClick={() => go('vault')}><div className="ic" style={{ background: 'var(--brand-soft)' }}>🗄️</div><div className="m"><div className="t">Add a document</div><div className="s">Scan, verify and store</div></div><span>›</span></div>
        <div className="row" onClick={() => go('assistant')}><div className="ic" style={{ background: 'var(--aqua-bg)' }}>💬</div><div className="m"><div className="t">Ask Vaulmo</div><div className="s">"When does my passport expire?"</div></div><span>›</span></div>
        <div className="row" onClick={() => go('connected')}><div className="ic" style={{ background: 'var(--violet-bg)' }}>🔌</div><div className="m"><div className="t">Connect your email</div><div className="s">Auto-import trips & receipts</div></div><span>›</span></div>
        <div className="row" onClick={() => go('family')}><div className="ic" style={{ background: 'var(--warn-bg)' }}>👪</div><div className="m"><div className="t">Add your family</div><div className="s">Next of kin & access</div></div><span>›</span></div>
      </Card>
    </div>
  </>;
}

const SAMPLE = `UNITED KINGDOM\nPASSPORT\nPassport No: 546872331\nSurname: REID\nNationality: British\nDate of expiry: 22 Mar 2027`;
function Vault({ toast }: any) {
  const { data, reload } = useData(() => api.documents());
  const { data: cl, reload: reloadCl } = useData(() => api.checklist());
  const [scan, setScan] = useState(false); const [text, setText] = useState(SAMPLE);
  const [doc, setDoc] = useState<any>(null); const [meta, setMeta] = useState<any>({}); const [busy, setBusy] = useState('');
  async function runScan() { setBusy('Scanning…'); try { const bytes = new Blob([text]).size; const init = await api.createDocument({ filename: 'doc.txt', contentType: 'text/plain', sizeBytes: bytes, title: 'Document' }); await uploadText(init.uploadUrl, text); const r = await api.processDocument(init.documentId); setDoc({ id: init.documentId, ...r }); const m: any = {}; r.extracted.forEach((f: any) => f.value && (m[f.key] = f.value)); setMeta(m); } finally { setBusy(''); } }
  async function confirm() { setBusy('Storing…'); try { await api.confirmDocument(doc.id, meta); setScan(false); setDoc(null); toast('Stored and reminders set'); reload(); reloadCl(); } finally { setBusy(''); } }
  const docs = data?.documents ?? [];
  return <>
    <div className="spread" style={{ marginBottom: 16 }}>
      <div className="flex"><b style={{ fontSize: 22 }}>{cl?.completionScore ?? 0}%</b><span className="muted">complete · {docs.length} documents</span></div>
      <button className="btn" onClick={() => { setScan(true); setDoc(null); setText(SAMPLE); }}>+ Add document</button>
    </div>
    {scan && <div className="card" style={{ marginBottom: 18 }}><div className="card-b">
      {!doc ? <>
        <label>Paste a synthetic document, then scan<textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13 }} /></label>
        <div className="flex"><button className="btn" onClick={runScan} disabled={!!busy}>{busy || 'Scan & extract'}</button><button className="btn sec" onClick={() => setScan(false)}>Cancel</button></div>
      </> : <>
        <div className="ok" style={{ marginBottom: 12 }}>Classified as <b>{doc.classification?.typeKey}</b> ({Math.round((doc.classification?.confidence ?? 0) * 100)}% · {doc.engine}). Check details, then confirm.</div>
        {doc.extracted.map((f: any) => <label key={f.key}>{f.label}<input value={meta[f.key] ?? ''} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} /></label>)}
        <div className="flex"><button className="btn" onClick={confirm} disabled={!!busy}>{busy || 'Confirm & store'}</button><button className="btn sec" onClick={() => setDoc(null)}>Back</button></div>
      </>}
    </div></div>}
    <Card title="Documents">
      {docs.map((d: any) => <div className="row" key={d.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{CATICON[d.typeKey ? cap(d.typeKey) : ''] ?? '📄'}</div><div className="m"><div className="t">{d.title}</div><div className="s">{d.typeKey ?? 'unclassified'} · {d.status}</div></div><span className={`pill ${d.status === 'CONFIRMED' ? 'p-good' : 'p-warn'}`}>{d.status === 'CONFIRMED' ? 'Verified' : 'Pending'}</span></div>)}
      {!docs.length && <div className="empty">No documents yet — add your first one.</div>}
    </Card>
  </>;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Assistant() {
  const [chat, setChat] = useState<any[]>([{ role: 'ai', text: "Hi! Ask me anything about your vault — e.g. \"when does my passport expire?\"" }]);
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  async function ask(question: string) { if (!question.trim()) return; setChat((c) => [...c, { role: 'me', text: question }]); setQ(''); setBusy(true); try { const r = await api.ask(question); setChat((c) => [...c, { role: 'ai', text: r.answer, sources: r.sources }]); } catch { setChat((c) => [...c, { role: 'ai', text: 'Something went wrong.' }]); } finally { setBusy(false); } }
  return <div style={{ maxWidth: 720 }}>
    <div style={{ marginBottom: 16 }}>{chat.map((m, i) => <div key={i} className={`assist-msg ${m.role === 'ai' ? 'ai' : 'me'}`}>{m.role === 'ai' && <div className="ab">L</div>}<div className="bub">{m.text}{m.sources?.length ? <div className="src">Sources: {m.sources.map((s: any) => s.ref).join(', ')}</div> : null}</div></div>)}</div>
    <div className="chips">{['When does my passport expire?', 'What do I need to know?', 'Find my home insurance'].map((s) => <button className="chip" key={s} onClick={() => ask(s)}>{s}</button>)}</div>
    <form className="flex" onSubmit={(e) => { e.preventDefault(); ask(q); }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" style={{ marginTop: 0 }} /><button className="btn" disabled={busy}>Ask</button></form>
  </div>;
}

function Reminders({ onRead }: any) {
  const { data: notifs, reload } = useData(() => api.notifications());
  const { data: rem } = useData(() => api.reminders());
  async function read(id: string) { await api.markRead(id); reload(); onRead(); }
  return <div className="grid2">
    <Card title="Notifications" right={<a onClick={async () => { await api.readAll(); reload(); onRead(); }}>Mark all read</a>}>
      {(notifs?.notifications ?? []).map((n: any) => <div className="row" key={n.id} onClick={() => !n.readAt && read(n.id)} style={{ cursor: n.readAt ? 'default' : 'pointer', opacity: n.readAt ? 0.6 : 1 }}><div className="ic" style={{ background: 'var(--warn-bg)' }}>{n.category === 'missing_document' ? '📄' : n.category === 'system' ? '⚙️' : '🔔'}</div><div className="m"><div className="t">{n.title}</div><div className="s">{n.body}</div></div>{!n.readAt && <span className="pill p-info">new</span>}</div>)}
      {!(notifs?.notifications ?? []).length && <div className="empty">No notifications.</div>}
    </Card>
    <Card title="Upcoming dates" right={`${rem?.live?.length ?? 0} live`}>
      {(rem?.live ?? []).map((r: any) => <div className="row" key={r.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>🗓️</div><div className="m"><div className="t">{r.title}</div><div className="s">{fmt(r.dueDate)}</div></div>{remPill(r)}</div>)}
      {!(rem?.live ?? []).length && <div className="empty">Nothing scheduled.</div>}
    </Card>
  </div>;
}

function Trips() {
  const { data } = useData(() => api.trips());
  const trips = data?.trips ?? [];
  return trips.length ? <>{trips.map((t: any) => <Card key={t.id} title={t.title} right={fmt(t.startDate)}>{t.items.map((i: any) => <div className="row" key={i.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{i.kind === 'flight' ? '✈️' : i.kind === 'hotel' ? '🏨' : i.kind === 'train' ? '🚆' : i.kind === 'car_rental' ? '🚗' : '🎟️'}</div><div className="m"><div className="t">{cap(i.kind)}</div><div className="s">{fmt(i.startDate)}</div></div></div>)}</Card>)}</> : <div className="empty">No trips yet. Connect your email to auto-import them.</div>;
}
function Purchases() {
  const { data } = useData(() => api.purchases());
  const ps = data?.purchases ?? [];
  return <Card title="Purchases & assets">{ps.map((p: any) => <div className="row" key={p.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{p.isAsset ? '📦' : '🧾'}</div><div className="m"><div className="t">{p.item}</div><div className="s">{p.merchant ?? ''} {p.amount ? '· ' + p.amount : ''}</div></div>{p.warrantyExpiry && <span className="pill p-info">warranty {fmt(p.warrantyExpiry)}</span>}</div>)}{!ps.length && <div className="empty">No purchases yet.</div>}</Card>;
}
function Subs({ toast }: any) {
  const { data, reload } = useData(() => api.trackedSubscriptions());
  const subs = data?.subscriptions ?? [];
  return <Card title="Tracked subscriptions" right={<a onClick={async () => { await api.confirmDetected; toast('Connect email to auto-detect'); }}>from email →</a>}>
    {subs.map((s: any) => <div className="row" key={s.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>🔁</div><div className="m"><div className="t">{cap(s.name)}</div><div className="s">{s.amount ?? ''} · {s.cycle}</div></div>{s.renewalDate && <span className="pill p-neutral">renews {fmt(s.renewalDate)}</span>}</div>)}
    {!subs.length && <div className="empty">No subscriptions tracked yet.</div>}
  </Card>;
}

function Connected({ toast }: any) {
  const { data: conns, reload } = useData(() => api.connections());
  const { data: det, reload: reloadDet } = useData(() => api.detected());
  const [busy, setBusy] = useState('');
  async function connect(p: string) { setBusy(p); try { await api.connectProvider(p); const code = 'demo_' + Math.random().toString(36).slice(2, 8); await api.callbackProvider(p, code); toast(`${cap(p)} connected`); await reload(); } finally { setBusy(''); } }
  async function connectBank() { setBusy('bank'); try { await api.connectBank(); const code = 'demo_' + Math.random().toString(36).slice(2, 8); await api.bankCallback(code); toast('Bank connected (sandbox)'); await reload(); } finally { setBusy(''); } }
  async function sync(id: string) { const r = await api.sync(id); toast(`Detected ${r.created} item${r.created === 1 ? '' : 's'}`); reloadDet(); }
  async function confirm(id: string) { const r = await api.confirmDetected(id); toast(`Added to ${r.entityType}`); reloadDet(); }
  const list = conns?.connections ?? []; const items = det?.detected ?? [];
  return <>
    <div className="grid2">
      <Card title="Connect a service">
        {['gmail', 'outlook'].map((p) => <div className="row" key={p}><div className="ic" style={{ background: 'var(--brand-soft)' }}>{p === 'gmail' ? '📧' : '📨'}</div><div className="m"><div className="t">{cap(p)}</div><div className="s">Import trips, receipts & subscriptions</div></div><button className="btn sm" onClick={() => connect(p)} disabled={!!busy}>{busy === p ? '…' : 'Connect'}</button></div>)}
        <div className="row"><div className="ic" style={{ background: 'var(--aqua-bg)' }}>🏦</div><div className="m"><div className="t">Open Banking</div><div className="s">Detect recurring subscriptions from your statement</div></div><button className="btn sm" onClick={connectBank} disabled={!!busy}>{busy === 'bank' ? '…' : 'Connect'}</button></div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Sandbox providers in this environment — read-only, tokens stored encrypted. Detected items never go live until you confirm them.</p>
      </Card>
      <Card title="Your connections">
        {list.map((c: any) => <div className="row" key={c.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>🔌</div><div className="m"><div className="t">{cap(c.provider)}</div><div className="s">{c.status}{c.lastSyncAt ? ' · synced ' + fmt(c.lastSyncAt) : ''}</div></div><button className="btn sm sec" onClick={() => sync(c.id)}>Sync</button></div>)}
        {!list.length && <div className="empty">No connections yet.</div>}
      </Card>
    </div>
    <div className="section">Detected — confirm to add</div>
    <Card title={`${items.length} items awaiting confirmation`}>
      {items.map((i: any) => <div className="row" key={i.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{i.source === 'bank' ? '🏦' : i.type === 'travel' ? '✈️' : i.type === 'purchase' ? '🧾' : i.type === 'ticket' ? '🎟️' : '🔁'}</div><div className="m"><div className="t">{i.rawSubject}</div><div className="s">{i.source === 'bank' ? 'recurring payment' : i.type} · from {i.rawFrom}{typeof i.extracted?.confidence === 'number' ? ` · ${Math.round(i.extracted.confidence * 100)}% match` : ''}</div></div><div className="flex"><button className="btn sm" onClick={() => confirm(i.id)}>Confirm</button><button className="btn sm sec" onClick={async () => { await api.dismissDetected(i.id); reloadDet(); }}>Dismiss</button></div></div>)}
      {!items.length && <div className="empty">Nothing pending — connect a service and sync.</div>}
    </Card>
  </>;
}

function Family({ toast }: any) {
  const { data: mem } = useData(() => api.familyMembers());
  const { data: nokd, reload } = useData(() => api.nok());
  const { data: emg } = useData(() => api.emergencyStatus());
  const [f, setF] = useState({ name: '', email: '', relationship: '' });
  async function nominate() { if (!f.name || !f.email) return; await api.nominateNok(f); setF({ name: '', email: '', relationship: '' }); toast('Next of kin nominated'); reload(); }
  async function invite(id: string) { const r = await api.inviteNok(id); toast('Invitation sent'); reload(); }
  return <>
    <div className="card" style={{ background: emg?.enabled ? 'var(--aqua-bg)' : 'var(--warn-bg)', border: 0, marginBottom: 18 }}><div className="card-b flex"><span style={{ fontSize: 22 }}>{emg?.enabled ? '🛡️' : '⏳'}</span><div><b>Emergency Access</b><div className="s muted">{emg?.message}</div></div></div></div>
    <div className="grid2">
      <Card title="Household">{(mem?.members ?? []).map((m: any) => <div className="row" key={m.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{m.isDependant ? '🧒' : '👤'}</div><div className="m"><div className="t">{m.name}</div><div className="s">{m.relationship ?? ''}{m.isDependant ? ' · dependant' : ''}</div></div></div>)}{!(mem?.members ?? []).length && <div className="empty">No family members yet.</div>}</Card>
      <Card title="Next of kin">
        {(nokd?.nextOfKin ?? []).map((n: any) => <div className="row" key={n.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>👤</div><div className="m"><div className="t">{n.name}</div><div className="s">{n.email}</div></div>{n.status === 'nominated' ? <button className="btn sm" onClick={() => invite(n.id)}>Invite</button> : <span className={`pill ${n.status === 'confirmed' ? 'p-good' : 'p-warn'}`}>{n.status}</span>}</div>)}
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
          <div className="flex"><input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ marginTop: 0 }} /><input placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={{ marginTop: 0 }} /><button className="btn sm" onClick={nominate}>Nominate</button></div>
        </div>
      </Card>
    </div>
  </>;
}

function Billing({ toast }: any) {
  const { data: plans } = useData(() => api.plans());
  const { data: ent } = useData(() => api.entitlements());
  async function subscribe(planKey: string) { try { const s = await api.checkout(planKey); toast('Opening Stripe Checkout…'); window.open?.(s.url, '_blank'); } catch (e) { toast((e as any).message); } }
  return <>
    <Card title="Current plan"><div className="flex"><b style={{ fontSize: 20, textTransform: 'capitalize' }}>{ent?.planKey ?? 'starter'}</b><span className={`pill ${ent?.active ? 'p-good' : 'p-crit'}`}>{ent?.active ? 'active' : 'inactive'}</span>{ent?.inGrace && <span className="pill p-warn">grace period</span>}</div><div className="muted" style={{ marginTop: 8, fontSize: 13 }}>AI assistant: {ent?.entitlements?.aiAssistant ? 'included' : 'not on this plan'} · Members: {ent?.entitlements?.members === -1 ? 'unlimited' : ent?.entitlements?.members ?? 1}</div></Card>
    <div className="section">Plans</div>
    <div className="plan-cards">{(plans?.plans ?? []).map((p: any) => <div className={`plan ${ent?.planKey === p.key ? 'cur' : ''}`} key={p.key}><div className="spread"><b style={{ textTransform: 'capitalize' }}>{p.name}</b>{ent?.planKey === p.key && <span className="pill p-info">current</span>}</div><div className="price">{p.amount === 0 ? 'Free' : '£' + (p.amount / 100).toFixed(0)}<span className="muted" style={{ fontSize: 13 }}>{p.amount ? '/yr' : ''}</span></div><div className="feat">✓ {p.entitlements?.members === -1 ? 'Unlimited' : p.entitlements?.members} members</div><div className="feat">{p.entitlements?.aiAssistant ? '✓ AI assistant' : '— AI assistant'}</div><div className="feat">{p.entitlements?.connectedServices ? '✓ Connected services' : '— Connected services'}</div>{p.key !== (ent?.planKey ?? 'starter') && p.amount > 0 && <button className="btn block sm" style={{ marginTop: 10 }} onClick={() => subscribe(p.key)}>Choose {p.name}</button>}</div>)}</div>
  </>;
}

function Settings({ me, toast }: any) {
  const [mfaOn, setMfaOn] = useState(!!me.mfaEnabled);
  const [enroll, setEnroll] = useState<any>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const { data: prefs, reload: reloadPrefs } = useData(() => api.notifSettings());
  const [verifyMsg, setVerifyMsg] = useState('');

  async function startMfa() { try { setEnroll(await api.enrollMfa()); } catch (e) { toast((e as any).message); } }
  async function confirmMfa() { try { const r = await api.confirmMfa(code); setCodes(r.recoveryCodes); setMfaOn(true); setEnroll(null); setCode(''); toast('Two-factor enabled'); } catch (e) { toast((e as any).message); } }
  async function togglePref(k: string, v: boolean) { await api.setNotifSettings({ [k]: v }); reloadPrefs(); }
  async function verify() { const r = await api.requestVerification(); if (r.devToken) { await api.verifyEmail(r.devToken); setVerifyMsg('Email verified ✓'); } else setVerifyMsg('Verification email sent — check your inbox.'); }

  return <>
    <Card title="Two-factor authentication">
      {mfaOn ? <div className="flex"><span className="pill p-good">Enabled</span><span className="muted">Your account is protected with an authenticator app.</span></div>
      : !enroll ? <><p className="muted" style={{ marginTop: 0 }}>Add a second layer of security with an authenticator app (Google Authenticator, 1Password, Authy).</p><button className="btn" onClick={startMfa}>Enable two-factor</button></>
      : <div className="flex" style={{ alignItems: 'flex-start' }}>
          <img src={enroll.qrDataUrl} width={150} height={150} style={{ borderRadius: 10, border: '1px solid var(--line)' }} alt="MFA QR" />
          <div style={{ flex: 1 }}>
            <p className="muted" style={{ marginTop: 0 }}>Scan the QR (or enter the key <code style={{ fontSize: 12 }}>{enroll.secret}</code>) then enter the 6-digit code:</p>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" style={{ maxWidth: 180 }} />
            <button className="btn" style={{ marginTop: 10 }} onClick={confirmMfa}>Confirm</button>
          </div>
        </div>}
      {codes && <div className="ok" style={{ marginTop: 12 }}>Save these one-time recovery codes: <b>{codes.join('  ')}</b></div>}
    </Card>

    <Card title="Notifications">
      {['inApp', 'email', 'push'].map((k) => <div className="row" key={k} style={{ borderBottom: '1px solid var(--surface-2)' }}>
        <div className="m"><div className="t">{k === 'inApp' ? 'In-app' : cap(k)}</div><div className="s">Reminders & alerts via {k === 'inApp' ? 'the app' : k}</div></div>
        <button className={`pill ${prefs?.[k] ? 'p-good' : 'p-neutral'}`} onClick={() => togglePref(k, !prefs?.[k])} style={{ cursor: 'pointer' }}>{prefs?.[k] ? 'On' : 'Off'}</button>
      </div>)}
    </Card>

    <Card title="Account">
      <div className="row"><div className="m"><div className="t">Email verification</div><div className="s">{me.email}</div></div><button className="btn sm sec" onClick={verify}>Verify email</button></div>
      {verifyMsg && <div className="ok" style={{ marginTop: 10 }}>{verifyMsg}</div>}
    </Card>

    <DevicesCard toast={toast} />
  </>;
}

function DevicesCard({ toast }: any) {
  const { data, reload } = useData(() => api.sessions());
  const rows = data?.sessions ?? [];
  function device(ua: string | null) {
    if (!ua) return 'Unknown device';
    if (/iphone|ipad|ios/i.test(ua)) return 'iOS device';
    if (/android/i.test(ua)) return 'Android device';
    if (/mac/i.test(ua)) return 'Mac';
    if (/windows/i.test(ua)) return 'Windows PC';
    return ua.slice(0, 40);
  }
  async function revoke(id: string) { await api.revokeSession(id); toast('Signed out that device'); reload(); }
  async function revokeOthers() { const r = await api.revokeOtherSessions(); toast(`Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}`); reload(); }
  const others = rows.filter((s: any) => !s.current).length;
  return <Card title="Devices & sessions" right={others ? <a onClick={revokeOthers}>Sign out others →</a> : undefined}>
    {rows.map((s: any) => <div className="row" key={s.id}>
      <div className="ic" style={{ background: 'var(--surface-2)' }}>💻</div>
      <div className="m"><div className="t">{device(s.userAgent)}{s.current && <span className="pill p-good" style={{ marginLeft: 8 }}>This device</span>}</div><div className="s">{s.ip ?? 'unknown IP'} · signed in {fmt(s.createdAt)}</div></div>
      {s.current ? <span className="muted" style={{ fontSize: 12.5 }}>current</span> : <button className="btn sm sec" onClick={() => revoke(s.id)}>Sign out</button>}
    </div>)}
    {!rows.length && <div className="empty">No active sessions.</div>}
  </Card>;
}

/* ---------------- admin views ---------------- */
const gbp = (v: number, c = 'gbp') => (c === 'usd' ? '$' : '£') + ((v ?? 0) / 100).toLocaleString();
const subPill = (s: string) => (s === 'active' || s === 'trialing' ? 'p-good' : s === 'past_due' ? 'p-warn' : s === 'canceled' ? 'p-crit' : 'p-neutral');

function AdminHome() {
  const { data: m } = useData(() => api.adminMetrics());
  const { data: a } = useData(() => api.adminAudit());
  return <>
    <div className="tiles">
      <Tile ic="🏢" bg="var(--brand-soft)" lab="Customers" val={m?.tenants ?? 0} />
      <Tile ic="✅" bg="var(--good-bg)" lab="Active subscriptions" val={m?.activeSubscriptions ?? 0} />
      <Tile ic="💷" bg="var(--aqua-bg)" lab="Annual revenue" val={gbp(m?.arr ?? 0)} />
      <Tile ic="👥" bg="var(--warn-bg)" lab="People" val={m?.users ?? 0} />
    </div>
    <Card title="Recent activity">
      {(a?.logs ?? []).slice(0, 10).map((l: any) => <div className="row" key={l.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{l.outcome === 'failure' ? '⚠️' : '•'}</div><div className="m"><div className="t">{l.action}</div><div className="s">{l.targetType ?? ''} · {l.outcome} · {fmt(l.at)}</div></div></div>)}
      {!(a?.logs ?? []).length && <div className="empty">No activity yet.</div>}
    </Card>
  </>;
}

function Customers({ toast }: any) {
  const { data } = useData(() => api.adminCustomers());
  const [open, setOpen] = useState('');
  const list = data?.customers ?? [];
  return <Card title={`${list.length} customer${list.length === 1 ? '' : 's'}`}>
    <table><thead><tr><th>Account</th><th>Owner</th><th>Plan</th><th>Subscription</th><th>People</th><th>Joined</th></tr></thead>
      <tbody>{list.map((c: any) => <Fragment key={c.id}>
        <tr onClick={() => setOpen(open === c.id ? '' : c.id)} style={{ cursor: 'pointer' }}>
          <td><b>{c.name}</b><div className="muted" style={{ fontSize: 12 }}>{c.type}</div></td>
          <td>{c.owner?.email ?? '—'}</td>
          <td style={{ textTransform: 'capitalize' }}>{c.plan ?? 'starter'}</td>
          <td><span className={`pill ${subPill(c.subscription?.status)}`}>{c.subscription?.status ?? 'none'}</span></td>
          <td>{c.memberCount}</td>
          <td>{fmt(c.createdAt)}</td>
        </tr>
        {open === c.id && <tr><td colSpan={6} style={{ background: 'var(--surface-2)', padding: 8 }}>
          {(c.members ?? []).map((mem: any) => <div className="row" key={mem.id} style={{ borderBottom: '1px solid var(--line)' }}><div className="ic" style={{ background: 'var(--surface)' }}>{(mem.roles ?? []).includes('tenant_owner') ? '👑' : '👤'}</div><div className="m"><div className="t">{mem.fullName}</div><div className="s">{mem.email} · {(mem.roles ?? []).join(', ') || 'member'}</div></div><span className="muted" style={{ fontSize: 12 }}>{mem.mfaEnabled ? 'MFA on' : 'MFA off'}{mem.lastLoginAt ? ' · last in ' + fmt(mem.lastLoginAt) : ''}</span></div>)}
          {!(c.members ?? []).length && <div className="empty">No people in this account.</div>}
        </td></tr>}
      </Fragment>)}</tbody></table>
    {!list.length && <div className="empty">No customers yet.</div>}
  </Card>;
}

function Subscriptions({ toast }: any) {
  const { data, reload } = useData(() => api.adminSubscriptions());
  const [busy, setBusy] = useState('');
  const subs = data?.subscriptions ?? [];
  const plans = data?.plans ?? [];
  const summary = data?.summary ?? { total: 0, active: 0, arr: 0 };
  const paidPlans = plans.filter((p: any) => (p.amount ?? 0) > 0);
  async function setPlan(tenantId: string, planKey: string, status: string) {
    setBusy(tenantId);
    try { await api.adminSetSubscription(tenantId, { planKey, status }); toast(status === 'canceled' ? 'Subscription cancelled' : 'Plan granted'); await reload(); }
    catch (e) { toast((e as any).message); } finally { setBusy(''); }
  }
  return <>
    <div className="tiles">
      <Tile ic="👥" bg="var(--brand-soft)" lab="Customers" val={summary.total} />
      <Tile ic="✅" bg="var(--good-bg)" lab="Active" val={summary.active} />
      <Tile ic="💷" bg="var(--aqua-bg)" lab="Annual revenue" val={gbp(summary.arr)} />
      <Tile ic="📦" bg="var(--warn-bg)" lab="Paid plans" val={paidPlans.length} />
    </div>
    <Card title="Customer subscriptions">
      <table><thead><tr><th>Customer</th><th>Plan</th><th>Status</th><th>Renews</th><th>Manage</th></tr></thead>
        <tbody>{subs.map((s: any) => <tr key={s.tenantId}>
          <td><b>{s.tenantName}</b></td>
          <td style={{ textTransform: 'capitalize' }}>{s.planKey ?? 'starter'}{s.amount ? ` · ${gbp(s.amount, s.currency)}/yr` : ''}</td>
          <td><span className={`pill ${subPill(s.status)}`}>{s.status}</span></td>
          <td>{s.currentPeriodEnd ? fmt(s.currentPeriodEnd) : '—'}</td>
          <td><div className="flex">
            <select disabled={busy === s.tenantId} value="" onChange={(e) => { if (e.target.value) setPlan(s.tenantId, e.target.value, 'active'); }} style={{ marginTop: 0, maxWidth: 150 }}>
              <option value="">Grant plan…</option>
              {paidPlans.map((p: any) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
            {(s.status === 'active' || s.status === 'trialing') && <button className="btn sm sec" disabled={busy === s.tenantId} onClick={() => setPlan(s.tenantId, s.planKey ?? 'starter', 'canceled')}>Cancel</button>}
          </div></td>
        </tr>)}</tbody></table>
      {!subs.length && <div className="empty">No customers yet.</div>}
    </Card>
    <div className="section">Plan catalogue</div>
    <Card title={`${plans.length} plans`}>
      <table><thead><tr><th>Plan</th><th>Price</th><th>Members</th><th>AI assistant</th><th>Connected services</th></tr></thead>
        <tbody>{plans.map((p: any) => <tr key={p.key}><td><b style={{ textTransform: 'capitalize' }}>{p.name}</b></td><td>{p.amount ? gbp(p.amount, p.currency) + '/yr' : 'Free'}</td><td>{p.entitlements?.members === -1 ? 'Unlimited' : p.entitlements?.members ?? 1}</td><td>{p.entitlements?.aiAssistant ? '✓' : '—'}</td><td>{p.entitlements?.connectedServices ? '✓' : '—'}</td></tr>)}</tbody></table>
    </Card>
  </>;
}
function Audit() { const { data } = useData(() => api.adminAudit()); return <Card title="Audit log">{(data?.logs ?? []).map((l: any) => <div className="row" key={l.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{l.outcome === 'failure' ? '⚠️' : '•'}</div><div className="m"><div className="t">{l.action}</div><div className="s">{l.targetType ?? ''} · {fmt(l.at)}</div></div><span className={`pill ${l.outcome === 'failure' ? 'p-crit' : 'p-neutral'}`}>{l.outcome}</span></div>)}</Card>; }
