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
  support: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  emergency: 'M12 3l7 3v5c0 4.4-2.9 8.3-7 9.5-4.1-1.2-7-5.1-7-9.5V6l7-3zM12 9v4M12 16h.01',
  reports: 'M3 3v18h18M8 17V9M13 17V5M18 17v-4',
  crm: 'M3 4h18l-7 8v6l-4 2v-8z',
  cms: 'M4 5a2 2 0 012-2h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2zM14 3v5h5M8 13h8M8 17h5',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.6 9a2.5 2.5 0 014.6 1.4c0 1.7-2.2 2-2.2 3.6M12 17h.01',
  profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 21a7 7 0 0114 0',
  security: 'M12 3l7 3v5c0 4.4-2.9 8.3-7 9.5-4.1-1.2-7-5.1-7-9.5V6l7-3z',
  roles: 'M8 11a3 3 0 100-6 3 3 0 000 6zM2 20a6 6 0 0112 0M17 11l1.5 1.5L22 9M15 4a3 3 0 010 6',
  catalogue: 'M4 4h11l5 5v11a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1zM14 4v5h5M7 13h8M7 17h5',
};
const Icon = ({ k, size = 20 }: { k: string; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[k] ?? ICONS.home} /></svg>;

// Vaulmo brand mark — blue vault-shield with a "V" and aqua lock dot.
let MARK_N = 0;
const Mark = ({ size = 36 }: { size?: number }) => {
  const id = `vm${++MARK_N}`;
  return <svg width={size} height={size} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', borderRadius: Math.round(size * 0.23) }}>
    <defs>
      <linearGradient id={`${id}bg`} x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#3B82F6" /><stop offset="0.55" stopColor="#2563EB" /><stop offset="1" stopColor="#1E3A8A" /></linearGradient>
      <linearGradient id={`${id}v`} x1="176" y1="196" x2="336" y2="196" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#2563EB" /><stop offset="1" stopColor="#1E40AF" /></linearGradient>
    </defs>
    <rect width="512" height="512" rx="116" fill={`url(#${id}bg)`} />
    <path d="M256 120 C300 120 336 132 372 150 L372 262 C372 336 326 388 256 414 C186 388 140 336 140 262 L140 150 C176 132 212 120 256 120 Z" fill="#ffffff" />
    <path d="M196 196 L256 322 L316 196" fill="none" stroke={`url(#${id}v)`} strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="256" cy="300" r="19" fill="#22D3EE" />
  </svg>;
};

/* ---------------- root ---------------- */
export function App() {
  const [me, setMe] = useState<any>(null);
  const [view, setView] = useState<'login' | 'register' | 'mfa'>('login');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [forceMfa, setForceMfa] = useState<any>(null);
  const [error, setError] = useState('');

  async function afterAuth(r: AuthResult) {
    if (r.mfaRequired && r.challengeToken) { setChallenge(r.challengeToken); setView('mfa'); return; }
    // Privileged admin without MFA — hold a restricted session and force enrolment.
    if (r.mfaSetupRequired && r.accessToken && r.refreshToken) { setTokens(r.accessToken, r.refreshToken); setForceMfa(r.user); return; }
    if (r.accessToken && r.refreshToken) { setTokens(r.accessToken, r.refreshToken); setMe(await api.me()); }
  }
  if (forceMfa) return <ForceMfaSetup user={forceMfa} onDone={(u: any) => { setForceMfa(null); setMe(u); }} onCancel={() => { setTokens(null, null); setForceMfa(null); setView('login'); }} />;
  if (me) return <Shell me={me} onSignOut={() => { setTokens(null, null); setMe(null); setView('login'); }} refreshMe={async () => setMe(await api.me())} />;

  return (
    <div className="auth-wrap">
      <div>
        <div className="brandmark"><Mark size={44} /><div><b>Vaulmo</b><span>Your life, organised</span></div></div>
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
  const [showPw, setShowPw] = useState(false);
  const lbl: any = { fullName: 'Full name', email: 'Email', password: 'Password' };
  return <form className="card auth-card" onSubmit={(e) => { e.preventDefault(); props.onSubmit(v); }}>
    <h1>{props.title}</h1>
    {props.fields.map((f) => f === 'password'
      ? <label key={f}>Password
          <span style={{ position: 'relative', display: 'block' }}>
            <input type={showPw ? 'text' : 'password'} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} required style={{ paddingRight: 62 }} />
            <a onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12.5, cursor: 'pointer', color: 'var(--brand)' }}>{showPw ? 'Hide' : 'Show'}</a>
          </span>
        </label>
      : <label key={f}>{lbl[f]}<input type={f === 'email' ? 'email' : 'text'} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} required /></label>)}
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

// Mandatory MFA enrolment for administrators — shown after a privileged sign-in with no MFA.
function ForceMfaSetup({ user, onDone, onCancel }: { user: any; onDone: (u: any) => void; onCancel: () => void }) {
  const [enroll, setEnroll] = useState<any>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function begin() { setErr(''); try { setEnroll(await api.enrollMfa()); } catch (e) { setErr((e as any).message); } }
  async function confirm() {
    setErr(''); setBusy(true);
    try {
      const r: any = await api.confirmMfa(code);
      if (r.accessToken && r.refreshToken) setTokens(r.accessToken, r.refreshToken);
      setPendingUser(r.user ?? user);
      setCodes(r.recoveryCodes ?? []);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Code did not match'); } finally { setBusy(false); }
  }

  return <div className="auth-wrap"><div>
    <div className="brandmark"><Mark size={44} /><div><b>Vaulmo</b><span>Administrator security</span></div></div>
    {err && <div className="err" style={{ width: 420, maxWidth: '92vw' }}>{err}</div>}
    <div className="card auth-card" style={{ width: 460 }}>
      {codes ? <>
        <h1>Save your recovery codes</h1>
        <p className="muted">Two-factor authentication is now on. Store these one-time recovery codes somewhere safe — each works once if you lose your authenticator.</p>
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 14, margin: '12px 0', fontFamily: 'monospace', fontSize: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{codes.map((c) => <div key={c}>{c}</div>)}</div>
        <button className="btn block" onClick={() => onDone(pendingUser)}>I've saved them — continue</button>
      </> : <>
        <h1>Set up two-factor authentication</h1>
        <p className="muted">Two-factor authentication is <b>required</b> for administrator accounts. Add Vaulmo to an authenticator app (Google Authenticator, 1Password, Authy) to continue.</p>
        {!enroll ? <button className="btn block" style={{ marginTop: 14 }} onClick={begin}>Begin setup</button> : <>
          <div style={{ textAlign: 'center', margin: '14px 0' }}>
            <img src={enroll.qrDataUrl} width={172} height={172} style={{ borderRadius: 10, border: '1px solid var(--line)' }} alt="Scan this QR code" />
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Or enter this key manually:</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{enroll.secret}</div>
          </div>
          <label>Enter the 6-digit code<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} /></label>
          <button className="btn block" style={{ marginTop: 10 }} disabled={busy || code.length < 6} onClick={confirm}>{busy ? 'Verifying…' : 'Verify & enable'}</button>
        </>}
        <div className="foot"><a onClick={onCancel}>Cancel and sign out</a></div>
      </>}
    </div>
  </div></div>;
}

/* ---------------- shell ---------------- */
const TENANT_NAV = [
  { grp: 'Vaulmo' }, { id: 'home', label: 'Home', ic: 'home' }, { id: 'vault', label: 'My Vault', ic: 'vault' },
  { id: 'assistant', label: 'Ask Vaulmo', ic: 'assistant' }, { id: 'reminders', label: 'Reminders', ic: 'reminders' },
  { grp: 'Life' }, { id: 'trips', label: 'Trips', ic: 'trips' }, { id: 'purchases', label: 'Purchases', ic: 'purchases' },
  { id: 'subs', label: 'Subscriptions', ic: 'subs' }, { id: 'connected', label: 'Connected', ic: 'connected' },
  { grp: 'Account' }, { id: 'profile', label: 'My Profile', ic: 'profile' }, { id: 'family', label: 'Family & Access', ic: 'family' }, { id: 'emergency', label: 'Emergency Access', ic: 'emergency' }, { id: 'billing', label: 'Plan & Billing', ic: 'billing' }, { id: 'support', label: 'Support', ic: 'support' }, { id: 'help', label: 'Help Centre', ic: 'help' }, { id: 'settings', label: 'Settings', ic: 'settings' },
];
const ADMIN_NAV = [{ grp: 'Platform' }, { id: 'home', label: 'Overview', ic: 'overview' }, { id: 'reports', label: 'Reports', ic: 'reports' }, { id: 'customers', label: 'Customers', ic: 'tenants' }, { id: 'crm', label: 'CRM', ic: 'crm' }, { id: 'subscriptions', label: 'Subscriptions', ic: 'billing' }, { id: 'support', label: 'Support', ic: 'support' }, { grp: 'Content' }, { id: 'cms', label: 'Knowledge base', ic: 'cms' }, { id: 'catalogue', label: 'Document Catalogue', ic: 'catalogue' }, { grp: 'Security' }, { id: 'security', label: 'Security', ic: 'security' }, { id: 'emergency', label: 'Emergency Access', ic: 'emergency' }, { id: 'roles', label: 'Admins & Roles', ic: 'roles' }, { id: 'audit', label: 'Audit', ic: 'audit' }, { grp: 'Account' }, { id: 'profile', label: 'My Profile', ic: 'profile' }, { id: 'settings', label: 'Settings', ic: 'settings' }];

function Shell({ me, onSignOut, refreshMe }: { me: any; onSignOut: () => void; refreshMe: () => Promise<void> }) {
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
    billing: ['Plan & Billing', 'Your Vaulmo subscription'], settings: ['Settings', 'Security & preferences'], profile: ['My Profile', 'Your account & details'], customers: ['Customers', 'Accounts & the people in them'], subscriptions: ['Subscriptions', 'Plans, status & revenue'], support: [isSuper ? 'Support desk' : 'Support', isSuper ? 'Manage customer tickets' : 'Get help & track your requests'], emergency: [isSuper ? 'Emergency Access review' : 'Emergency Access', isSuper ? 'Security review & due diligence' : 'Requests to access your vault'], reports: ['Reporting & analytics', 'Growth, usage & revenue'], crm: ['Customer CRM', 'Lifecycle, tags, notes & troubleshooting'], cms: ['Knowledge base', 'Help articles & content'], catalogue: ['Document Catalogue', 'Recommended documents, metadata & reminder rules'], help: ['Help Centre', 'Guides & answers'], security: ['Security', 'Sign-in threats, lockouts & sessions'], roles: ['Admins & Roles', 'Administrative users & least-privilege roles'], audit: ['Audit Log', 'Platform activity'],
  };
  const [t0, t1] = titles[active] ?? ['', ''];
  const views: any = { home: isSuper ? <AdminHome /> : <Home me={me} go={setActive} />, vault: <Vault toast={toast} />, assistant: <Assistant />, reminders: <Reminders onRead={() => api.unread().then((r) => setUnread(r.unread))} />, trips: <Trips />, purchases: <Purchases />, subs: <Subs toast={toast} />, connected: <Connected toast={toast} />, family: <Family toast={toast} />, billing: <Billing toast={toast} />, settings: <Settings me={me} toast={toast} />, profile: <Profile me={me} toast={toast} refreshMe={refreshMe} go={setActive} />, customers: <Customers toast={toast} />, subscriptions: <Subscriptions toast={toast} />, support: isSuper ? <AdminSupport toast={toast} /> : <SupportTenant toast={toast} />, emergency: isSuper ? <AdminEmergency toast={toast} /> : <EmergencyTenant toast={toast} />, reports: <AdminReports />, crm: <AdminCRM toast={toast} />, cms: <AdminCMS toast={toast} />, catalogue: <AdminCatalogue toast={toast} />, help: <HelpCenter />, security: <AdminSecurity toast={toast} />, roles: <AdminRoles toast={toast} me={me} />, audit: <Audit /> };

  return <div className="app">
    <aside className="sidebar">
      <div className="sb-brand"><Mark size={34} /><div><b>Vaulmo</b><span>{isSuper ? 'Admin' : 'Family Vault'}</span></div></div>
      <nav className="nav">{nav.map((n: any, i) => n.grp ? <div className="grp" key={i}>{n.grp}</div> :
        <button key={n.id} className={active === n.id ? 'on' : ''} onClick={() => setActive(n.id)}><Icon k={n.ic} />{n.label}{n.id === 'reminders' && unread > 0 && <span className="dot">{unread}</span>}</button>)}
      </nav>
      <div className="sb-foot"><div className="av">{me.fullName.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</div><div><div className="nm">{me.fullName}</div><div className="rl">{isSuper ? 'Super Admin' : me.tenant?.name ?? 'Member'}</div></div></div>
    </aside>
    <main className="main">
      <div className="top"><div><h2>{t0}</h2><div className="sub">{t1}</div></div>
        <div className="sp"><NotificationBell onOpenReminders={!isSuper ? () => setActive('reminders') : undefined} /><button className="btn sec sm" onClick={onSignOut}>Sign out</button></div>
      </div>
      <div className="view" key={active}>{views[active]}</div>
    </main>
    {node}
  </div>;
}

/* ---------------- notifications bell ---------------- */
const notifIcon = (c: string) => (c === 'missing_document' ? '📄' : c === 'system' ? '⚙️' : c === 'emergency' ? '🛡️' : c === 'billing' ? '💳' : '🔔');
function NotificationBell({ onOpenReminders }: { onOpenReminders?: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const loadCount = () => api.unread().then((r) => setUnread(r.unread)).catch(() => {});
  const loadList = () => api.notifications().then((r) => setItems(r.notifications ?? [])).catch(() => {});
  useEffect(() => { loadCount(); const t = setInterval(loadCount, 60000); return () => clearInterval(t); }, []);
  function toggle() { const n = !open; setOpen(n); if (n) loadList(); }
  async function read(id: string) { await api.markRead(id); loadList(); loadCount(); }
  async function readAll() { await api.readAll(); loadList(); loadCount(); }
  return <div style={{ position: 'relative' }}>
    <button className="bell" onClick={toggle}>🔔{unread > 0 && <span className="dot">{unread}</span>}</button>
    {open && <>
      <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', right: 0, top: 48, width: 344, maxHeight: 460, overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 12px 34px rgba(16,22,35,.16)', zIndex: 50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><b style={{ fontSize: 14 }}>Notifications</b>{items.some((n) => !n.readAt) && <a onClick={readAll} style={{ fontSize: 12.5 }}>Mark all read</a>}</div>
        {items.length ? items.slice(0, 20).map((n) => <div key={n.id} onClick={() => !n.readAt && read(n.id)} style={{ display: 'flex', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--surface-2)', cursor: n.readAt ? 'default' : 'pointer', background: n.readAt ? 'transparent' : 'var(--brand-soft)' }}>
          <span style={{ fontSize: 16, flex: 'none' }}>{notifIcon(n.category)}</span>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.title}</div><div style={{ fontSize: 12.5, color: 'var(--soft)' }}>{n.body}</div><div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{fmt(n.createdAt)}</div></div>
          {!n.readAt && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--brand-2)', flex: 'none', marginTop: 6 }} />}
        </div>) : <div className="empty" style={{ padding: '26px 16px' }}>You're all caught up.</div>}
        {onOpenReminders && <div style={{ padding: 10, textAlign: 'center', borderTop: '1px solid var(--line)' }}><a onClick={() => { setOpen(false); onOpenReminders(); }} style={{ fontSize: 13 }}>View all in Reminders →</a></div>}
      </div>
    </>}
  </div>;
}

/* ---------------- my profile ---------------- */
function Profile({ me, toast, refreshMe, go }: any) {
  const [name, setName] = useState(me.fullName);
  const [busy, setBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState('');
  const isSuper = me?.roles?.includes('super_admin');
  const initials = (me.fullName || '?').split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const dirty = name.trim() && name.trim() !== me.fullName;
  async function save() { setBusy(true); try { await api.updateProfile(name.trim()); await refreshMe(); toast('Profile updated'); } catch (e) { toast((e as any).message); } finally { setBusy(false); } }
  async function verify() { try { const r = await api.requestVerification(); if (r.devToken) { await api.verifyEmail(r.devToken); setVerifyMsg('Email verified ✓'); await refreshMe(); } else setVerifyMsg('Verification email sent — check your inbox.'); } catch (e) { toast((e as any).message); } }

  return <>
    <Card title="Profile">
      <div className="flex" style={{ gap: 16, alignItems: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg,#3B82F6,#1E3A8A)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22, flex: 'none' }}>{initials.toUpperCase()}</div>
        <div><div style={{ fontSize: 18, fontWeight: 700 }}>{me.fullName}</div><div className="muted" style={{ fontSize: 13.5 }}>{me.email}</div>
          <div style={{ marginTop: 5 }}><span className={`pill ${isSuper ? 'p-info' : 'p-neutral'}`}>{isSuper ? 'Super Admin' : me.tenant?.name ?? 'Member'}</span> {me.mfaEnabled ? <span className="pill p-good" style={{ marginLeft: 4 }}>2FA on</span> : <span className="pill p-warn" style={{ marginLeft: 4 }}>2FA off</span>}</div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 14 }}>
        <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn" style={{ marginTop: 10 }} disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </Card>

    <Card title="Account details">
      <div className="row"><div className="m"><div className="t">Email</div><div className="s">{me.email}</div></div>{me.emailVerified ? <span className="pill p-good">verified</span> : <button className="btn sm sec" onClick={verify}>Verify email</button>}</div>
      {verifyMsg && <div className="ok" style={{ margin: '10px 0' }}>{verifyMsg}</div>}
      <div className="row"><div className="m"><div className="t">Account type</div><div className="s">{isSuper ? 'Platform administrator' : 'Household member'}</div></div></div>
      {!isSuper && me.tenant && <div className="row"><div className="m"><div className="t">Plan</div><div className="s" style={{ textTransform: 'capitalize' }}>{me.tenant.plan} · {me.tenant.status}</div></div>{go && <button className="btn sm sec" onClick={() => go('billing')}>Manage</button>}</div>}
      <div className="row"><div className="m"><div className="t">Member since</div><div className="s">{fmt(me.createdAt)}</div></div></div>
      <div className="row"><div className="m"><div className="t">Two-factor authentication</div><div className="s">{me.mfaEnabled ? 'Enabled' : 'Not enabled'}</div></div><button className="btn sm sec" onClick={() => go && go('settings')}>Security settings</button></div>
    </Card>
  </>;
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
  const { data: status, reload: reloadStatus } = useData(() => api.adminBillingStatus());
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const subs = data?.subscriptions ?? [];
  const plans = data?.plans ?? [];
  const summary = data?.summary ?? { total: 0, active: 0, arr: 0 };
  const paidPlans = plans.filter((p: any) => (p.amount ?? 0) > 0);
  const st = status ?? {};

  async function setPlan(tenantId: string, planKey: string, status: string) {
    setBusy(tenantId);
    try { await api.adminSetSubscription(tenantId, { planKey, status }); toast(status === 'canceled' ? 'Subscription cancelled' : 'Plan granted'); await reload(); }
    catch (e) { toast((e as any).message); } finally { setBusy(''); }
  }
  function startEdit(p?: any) {
    setEdit(p
      ? { key: p.key, name: p.name, amountPounds: (p.amount ?? 0) / 100, members: p.entitlements?.members ?? 1, aiAssistant: !!p.entitlements?.aiAssistant, connectedServices: !!p.entitlements?.connectedServices, active: p.active !== false, isNew: false }
      : { key: '', name: '', amountPounds: 0, members: 1, aiAssistant: false, connectedServices: false, active: true, isNew: true });
  }
  async function savePlan() {
    const e = edit;
    if (!e.key || !e.name) { toast('Key and name are required'); return; }
    setBusy('plan');
    try {
      await api.adminUpsertPlan({ key: e.key, name: e.name, amount: Math.round((Number(e.amountPounds) || 0) * 100), currency: 'gbp', interval: 'year', entitlements: { members: Number(e.members), aiAssistant: !!e.aiAssistant, connectedServices: !!e.connectedServices }, active: !!e.active });
      toast('Plan saved'); setEdit(null); await reload(); await reloadStatus();
    } catch (err) { toast((err as any).message); } finally { setBusy(''); }
  }

  const modeLabel = st.driver === 'stripe' ? (st.mode === 'live' ? 'LIVE payments' : 'Stripe TEST mode') : 'Sandbox — no real charges';
  const chk = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14 } as const;
  return <>
    <div className="card" style={{ marginBottom: 18, background: st.liveReady ? 'var(--good-bg)' : 'var(--warn-bg)', border: 0 }}>
      <div className="card-b">
        <div className="flex" style={{ justifyContent: 'space-between' }}><div><b>Payments</b> <span className={`pill ${st.liveReady ? 'p-good' : st.driver === 'stripe' ? 'p-warn' : 'p-neutral'}`} style={{ marginLeft: 6 }}>{modeLabel}</span></div><div className="muted" style={{ fontSize: 12.5 }}>{st.plansProvisioned ?? 0}/{st.plansTotal ?? 0} plans synced to Stripe</div></div>
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {st.driver !== 'stripe' ? 'Billing is in safe sandbox mode — no real cards are charged. To accept payments, set STRIPE_DRIVER=stripe and your Stripe keys on the server, then test checkout before going live.'
            : st.mode === 'live' ? 'Live payments are enabled — real cards will be charged.'
            : 'Connected to Stripe TEST mode (use test cards). Switch the secret key to a live key only after testing checkout, webhooks and cancellation.'}
          {' '}Secret key: {st.hasSecretKey ? '✓ set' : '— missing'} · Webhook secret: {st.hasWebhookSecret ? '✓ set' : '— missing'}.
        </div>
      </div>
    </div>

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

    <div className="section">Plans <a onClick={() => startEdit()} style={{ float: 'right', fontSize: 13, cursor: 'pointer', color: 'var(--brand)' }}>+ Add plan</a></div>
    <Card title={`${plans.length} plans`}>
      <table><thead><tr><th>Plan</th><th>Price</th><th>Members</th><th>AI</th><th>Connected</th><th>Stripe</th><th></th></tr></thead>
        <tbody>{plans.map((p: any) => <tr key={p.key}>
          <td><b style={{ textTransform: 'capitalize' }}>{p.name}</b>{p.active === false && <span className="pill p-neutral" style={{ marginLeft: 8 }}>inactive</span>}</td>
          <td>{p.amount ? gbp(p.amount, p.currency) + '/yr' : 'Free'}</td>
          <td>{p.entitlements?.members === -1 ? 'Unlimited' : p.entitlements?.members ?? 1}</td>
          <td>{p.entitlements?.aiAssistant ? '✓' : '—'}</td>
          <td>{p.entitlements?.connectedServices ? '✓' : '—'}</td>
          <td>{p.stripePriceId ? <span className="pill p-good">synced</span> : <span className="pill p-neutral">—</span>}</td>
          <td><button className="btn sm sec" onClick={() => startEdit(p)}>Edit</button></td>
        </tr>)}</tbody></table>
    </Card>

    {edit && <Card title={edit.isNew ? 'Add plan' : `Edit plan · ${edit.name}`}>
      <div className="grid2">
        <label>Key (id, lowercase)<input value={edit.key} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} placeholder="family" /></label>
        <label>Display name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Family" /></label>
        <label>Price £ / year<input type="number" value={edit.amountPounds} onChange={(e) => setEdit({ ...edit, amountPounds: e.target.value })} /></label>
        <label>Members (-1 = unlimited)<input type="number" value={edit.members} onChange={(e) => setEdit({ ...edit, members: e.target.value })} /></label>
      </div>
      <div className="flex" style={{ marginTop: 12, gap: 20, flexWrap: 'wrap' }}>
        <span style={chk}><input type="checkbox" checked={edit.aiAssistant} onChange={(e) => setEdit({ ...edit, aiAssistant: e.target.checked })} style={{ width: 'auto', marginTop: 0 }} /> AI assistant</span>
        <span style={chk}><input type="checkbox" checked={edit.connectedServices} onChange={(e) => setEdit({ ...edit, connectedServices: e.target.checked })} style={{ width: 'auto', marginTop: 0 }} /> Connected services</span>
        <span style={chk}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} style={{ width: 'auto', marginTop: 0 }} /> Active (shown to customers)</span>
      </div>
      <div className="flex" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy === 'plan'} onClick={savePlan}>{busy === 'plan' ? 'Saving…' : 'Save plan'}</button>
        <button className="btn sec" onClick={() => setEdit(null)}>Cancel</button>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Saving also syncs the plan to Stripe (a product + price) when Stripe is connected.</p>
    </Card>}
  </>;
}
function Audit() { const { data } = useData(() => api.adminAudit()); return <Card title="Audit log">{(data?.logs ?? []).map((l: any) => <div className="row" key={l.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{l.outcome === 'failure' ? '⚠️' : '•'}</div><div className="m"><div className="t">{l.action}</div><div className="s">{l.targetType ?? ''} · {fmt(l.at)}</div></div><span className={`pill ${l.outcome === 'failure' ? 'p-crit' : 'p-neutral'}`}>{l.outcome}</span></div>)}</Card>; }

const tkPill = (s: string) => (s === 'open' ? 'p-warn' : s === 'pending' ? 'p-info' : 'p-neutral');
const taStyle = { width: '100%', marginTop: 6, borderRadius: 10, border: '1px solid var(--line)', padding: 10, fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box' } as const;
function Thread({ messages }: any) {
  return <>{(messages ?? []).map((m: any) => <div key={m.id} style={{ display: 'flex', justifyContent: m.authorRole === 'support' ? 'flex-start' : 'flex-end', marginBottom: 10 }}>
    <div style={{ maxWidth: '75%', background: m.authorRole === 'support' ? 'var(--brand-soft)' : 'var(--surface-2)', padding: '10px 12px', borderRadius: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{m.authorRole === 'support' ? 'Vaulmo Support' : 'Customer'} · {fmt(m.createdAt)}</div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.body}</div>
    </div></div>)}</>;
}

function SupportTenant({ toast }: any) {
  const { data, reload } = useData(() => api.supportTickets());
  const [sel, setSel] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({ subject: '', priority: 'normal', body: '' });
  const [reply, setReply] = useState('');
  const tickets = data?.tickets ?? [];
  async function open(id: string) { setSel(await api.supportTicket(id)); }
  async function submit() { if (!form.subject || !form.body) { toast('Subject and message are required'); return; } await api.createSupportTicket(form); setCreating(false); setForm({ subject: '', priority: 'normal', body: '' }); toast('Ticket raised'); await reload(); }
  async function send() { if (!reply.trim()) return; await api.supportReply(sel.ticket.id, reply); setReply(''); setSel(await api.supportTicket(sel.ticket.id)); await reload(); }

  if (sel) return <>
    <a onClick={() => setSel(null)} style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>← All tickets</a>
    <div style={{ height: 10 }} />
    <Card title={sel.ticket.subject} right={<span className={`pill ${tkPill(sel.ticket.status)}`}>{sel.ticket.status}</span>}>
      <Thread messages={sel.messages} />
      {sel.ticket.status !== 'closed'
        ? <div className="flex" style={{ marginTop: 12 }}><input placeholder="Type a reply…" value={reply} onChange={(e) => setReply(e.target.value)} style={{ marginTop: 0 }} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} /><button className="btn" onClick={send}>Send</button></div>
        : <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>This ticket is closed — send a reply to reopen it.</div>}
    </Card>
  </>;

  return <Card title="Your tickets" right={<a onClick={() => setCreating(!creating)} style={{ cursor: 'pointer', color: 'var(--brand)' }}>{creating ? 'Cancel' : '+ New ticket'}</a>}>
    {creating && <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14, marginBottom: 12 }}>
      <div className="grid2">
        <label>Subject<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="What do you need help with?" /></label>
        <label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
      </div>
      <label>Message<textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3} placeholder="Describe your issue…" style={taStyle} /></label>
      <button className="btn" style={{ marginTop: 10 }} onClick={submit}>Raise ticket</button>
    </div>}
    {tickets.map((t: any) => <div className="row" key={t.id} onClick={() => open(t.id)} style={{ cursor: 'pointer' }}><div className="ic" style={{ background: 'var(--surface-2)' }}>💬</div><div className="m"><div className="t">{t.subject}</div><div className="s">{t.messageCount} message{t.messageCount === 1 ? '' : 's'} · updated {fmt(t.updatedAt)}</div></div><span className={`pill ${tkPill(t.status)}`}>{t.status}</span></div>)}
    {!tickets.length && !creating && <div className="empty">No tickets yet. Raise one and we'll help.</div>}
  </Card>;
}

function AdminSupport({ toast }: any) {
  const { data, reload } = useData(() => api.adminSupportTickets());
  const { data: cust } = useData(() => api.adminCustomers());
  const [status, setStatus] = useState('all');
  const [sel, setSel] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>({ tenantId: '', subject: '', priority: 'normal', body: '' });
  const all = data?.tickets ?? [];
  const customers = cust?.customers ?? [];
  const counts = data?.counts ?? { open: 0, pending: 0, closed: 0 };
  const tickets = status === 'all' ? all : all.filter((t: any) => t.status === status);
  async function open(id: string) { setSel(await api.adminSupportTicket(id)); }
  async function send() { if (!reply.trim()) return; await api.adminSupportReply(sel.ticket.id, reply); setReply(''); setSel(await api.adminSupportTicket(sel.ticket.id)); await reload(); toast('Reply sent'); }
  async function setSt(s: string) { await api.adminSupportStatus(sel.ticket.id, s); setSel(await api.adminSupportTicket(sel.ticket.id)); await reload(); }
  async function raise() {
    if (!form.tenantId || !form.subject || !form.body) { toast('Choose a customer and add a subject and message'); return; }
    try { await api.adminCreateTicketFor(form); toast('Ticket raised on behalf'); setCreating(false); setForm({ tenantId: '', subject: '', priority: 'normal', body: '' }); await reload(); }
    catch (e) { toast((e as any).message); }
  }

  if (sel) return <>
    <a onClick={() => setSel(null)} style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>← All tickets</a>
    <div style={{ height: 10 }} />
    <Card title={sel.ticket.subject} right={<span className={`pill ${tkPill(sel.ticket.status)}`}>{sel.ticket.status}</span>}>
      <div className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 12 }}>{sel.ticket.customer} · {sel.ticket.requester?.email ?? '—'} · {sel.ticket.priority} priority</div>
      <Thread messages={sel.messages} />
      <div className="flex" style={{ marginTop: 12 }}><input placeholder="Reply to the customer…" value={reply} onChange={(e) => setReply(e.target.value)} style={{ marginTop: 0 }} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} /><button className="btn" onClick={send}>Send</button></div>
      <div className="flex" style={{ marginTop: 12, gap: 8 }}>
        {sel.ticket.status !== 'closed' ? <button className="btn sm sec" onClick={() => setSt('closed')}>Close ticket</button> : <button className="btn sm sec" onClick={() => setSt('open')}>Reopen</button>}
        {sel.ticket.status !== 'pending' && sel.ticket.status !== 'closed' && <button className="btn sm sec" onClick={() => setSt('pending')}>Mark awaiting customer</button>}
      </div>
    </Card>
  </>;

  return <>
    <div className="tiles">
      <Tile ic="🟠" bg="var(--warn-bg)" lab="Open" val={counts.open ?? 0} />
      <Tile ic="🔵" bg="var(--aqua-bg)" lab="Awaiting customer" val={counts.pending ?? 0} />
      <Tile ic="✅" bg="var(--good-bg)" lab="Closed" val={counts.closed ?? 0} />
      <Tile ic="📨" bg="var(--brand-soft)" lab="Total" val={all.length} />
    </div>
    <Card title="Tickets" right={<div className="flex" style={{ gap: 10, alignItems: 'center' }}><a onClick={() => setCreating(!creating)} style={{ cursor: 'pointer', color: 'var(--brand-2)', fontSize: 13 }}>{creating ? 'Cancel' : '+ Raise on behalf'}</a><select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginTop: 0, maxWidth: 170 }}><option value="all">All</option><option value="open">Open</option><option value="pending">Awaiting customer</option><option value="closed">Closed</option></select></div>}>
      {creating && <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14, marginBottom: 12 }}>
        <div className="grid2">
          <label>Customer<select value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}><option value="">Choose a customer…</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.owner ? ` · ${c.owner.email}` : ''}</option>)}</select></label>
          <label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        </div>
        <label>Subject<input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Summarise the issue" /></label>
        <label style={{ display: 'block', marginTop: 8 }}>Message<textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3} placeholder="Describe the issue on the customer's behalf…" style={taStyle} /></label>
        <button className="btn" style={{ marginTop: 10 }} onClick={raise}>Raise ticket</button>
      </div>}
      <table><thead><tr><th>Subject</th><th>Customer</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>{tickets.map((t: any) => <tr key={t.id} onClick={() => open(t.id)} style={{ cursor: 'pointer' }}>
          <td><b>{t.subject}</b><div className="muted" style={{ fontSize: 12 }}>{t.messageCount} message{t.messageCount === 1 ? '' : 's'}</div></td>
          <td>{t.customer}<div className="muted" style={{ fontSize: 12 }}>{t.requester ?? ''}</div></td>
          <td style={{ textTransform: 'capitalize' }}>{t.priority}</td>
          <td><span className={`pill ${tkPill(t.status)}`}>{t.status}</span></td>
          <td>{fmt(t.updatedAt)}</td>
        </tr>)}</tbody></table>
      {!tickets.length && <div className="empty">No tickets{status !== 'all' ? ` with status "${status}"` : ' yet'}.</div>}
    </Card>
  </>;
}

/* ---------------- Emergency Access (Phase 8) ---------------- */
const EM_META: Record<string, { pill: string; label: string }> = {
  pending: { pill: 'p-warn', label: 'Awaiting owner' },
  owner_approved: { pill: 'p-info', label: 'Awaiting security review' },
  owner_declined: { pill: 'p-neutral', label: 'Owner declined' },
  security_declined: { pill: 'p-crit', label: 'Declined in review' },
  active: { pill: 'p-good', label: 'Access active' },
  revoked: { pill: 'p-crit', label: 'Revoked' },
};
const emMeta = (s: string) => EM_META[s] ?? { pill: 'p-neutral', label: s };
const DD_CHECKS: [string, string][] = [
  ['identityVerified', 'Requester identity verified (government photo ID)'],
  ['relationshipConfirmed', 'Relationship to the account holder confirmed'],
  ['legalBasisConfirmed', 'Legal basis on file (death certificate, power of attorney or court order)'],
  ['ownerUnreachable', 'Account holder confirmed deceased or incapacitated'],
  ['noObjection', 'No outstanding objection from other family members'],
];
const SCOPE_CATS = ['will', 'insurance', 'property', 'financial', 'identity', 'medical'];

function EmergencyBanner() {
  const { data } = useData(() => api.emergencyFeature());
  const enabled = data?.enabled;
  if (data === null || data === undefined) return null;
  return <div className="card" style={{ marginBottom: 18, background: enabled ? 'var(--good-bg)' : 'var(--warn-bg)', border: 0 }}>
    <div className="card-b" style={{ fontSize: 13 }}>
      <b>{enabled ? 'Emergency Access is live' : 'Emergency Access — coming soon'}</b>
      <div className="muted" style={{ marginTop: 6 }}>{enabled
        ? 'Confirmed next-of-kin can request temporary, restricted access. Every request runs through owner approval, a 7-day waiting period and a super-admin security review before any access is granted.'
        : 'This feature is switched off until the legal process, identity checks and operating procedures are finalised. Existing requests are shown here, but new requests are blocked. To enable it, set EMERGENCY_ACCESS_ENABLED=true on the server.'}</div>
    </div>
  </div>;
}

function EmergencyTenant({ toast }: any) {
  const { data, reload } = useData(() => api.emergencyRequests());
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const reqs = data?.requests ?? [];
  async function decide(id: string, decision: 'approve' | 'decline') {
    setBusy(id);
    try { await api.emergencyOwnerDecision(id, { decision, note: note[id] }); toast(decision === 'approve' ? 'Approved — sent for security review' : 'Request declined'); await reload(); }
    catch (e) { toast((e as any).message); } finally { setBusy(''); }
  }
  async function revoke(id: string) {
    setBusy(id);
    try { await api.emergencyRevoke(id); toast('Access revoked'); await reload(); }
    catch (e) { toast((e as any).message); } finally { setBusy(''); }
  }
  return <>
    <EmergencyBanner />
    <Card title="Requests for your vault">
      {reqs.map((r: any) => { const m = emMeta(r.status); return <div key={r.id} style={{ borderBottom: '1px solid var(--line)', padding: '14px 0' }}>
        <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div><b>{r.requesterName}</b> <span className="muted" style={{ fontSize: 12.5 }}>· {r.requesterEmail}</span>
            <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{r.reason || 'No reason given'}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>Requested {fmt(r.requestedAt)}{r.accessExpiresAt ? ` · access until ${fmt(r.accessExpiresAt)}` : ''}</div>
          </div>
          <span className={`pill ${m.pill}`}>{m.label}</span>
        </div>
        {r.status === 'pending' && <div style={{ marginTop: 10 }}>
          <input placeholder="Add a note (optional)" value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} style={{ marginTop: 0 }} />
          <div className="flex" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn sm" disabled={busy === r.id} onClick={() => decide(r.id, 'approve')}>Approve</button>
            <button className="btn sm sec" disabled={busy === r.id} onClick={() => decide(r.id, 'decline')}>Decline</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Approving does not grant access immediately — it starts a 7-day waiting period and a security review by Vaulmo before any access is given.</p>
        </div>}
        {r.status === 'active' && <div className="flex" style={{ marginTop: 10 }}><button className="btn sm sec" disabled={busy === r.id} onClick={() => revoke(r.id)}>Revoke access now</button></div>}
      </div>; })}
      {!reqs.length && <div className="empty">No emergency access requests. If a next-of-kin ever needs access, their request will appear here for your approval.</div>}
    </Card>
  </>;
}

function AdminEmergency({ toast }: any) {
  const { data, reload } = useData(() => api.emergencyRequests());
  const [sel, setSel] = useState<any>(null);
  const [dd, setDd] = useState<Record<string, boolean>>({});
  const [cats, setCats] = useState<string[]>([]);
  const [days, setDays] = useState(7);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const reqs = data?.requests ?? [];
  const count = (s: string) => reqs.filter((r: any) => r.status === s).length;

  function pick(r: any) {
    setSel(r); setNotes(r.securityNotes ?? ''); setDays(7);
    setDd((r.dueDiligence as any) ?? {}); setCats(((r.accessScope as any)?.categories) ?? []);
  }
  const pendingElapsed = (r: any) => new Date() >= new Date(r.pendingUntil);
  const allChecked = DD_CHECKS.every(([k]) => dd[k]);

  async function review(decision: 'approve' | 'decline') {
    if (!sel) return;
    if (decision === 'approve' && !allChecked) { toast('Complete every due-diligence check before granting access'); return; }
    setBusy(true);
    try {
      await api.emergencySecurityReview(sel.id, { decision, notes, dueDiligence: dd, accessScope: cats.length ? { categories: cats } : {}, accessDays: days });
      toast(decision === 'approve' ? 'Access granted (restricted & temporary)' : 'Request declined');
      setSel(null); await reload();
    } catch (e) { toast((e as any).message); } finally { setBusy(false); }
  }
  async function revoke(id: string) { setBusy(true); try { await api.emergencyRevoke(id); toast('Access revoked'); setSel(null); await reload(); } catch (e) { toast((e as any).message); } finally { setBusy(false); } }

  if (sel) { const m = emMeta(sel.status); const canReview = sel.status === 'owner_approved'; const elapsed = pendingElapsed(sel); return <>
    <a onClick={() => setSel(null)} style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>← All requests</a>
    <div style={{ height: 10 }} />
    <Card title={`Request from ${sel.requesterName}`} right={<span className={`pill ${m.pill}`}>{m.label}</span>}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{sel.requesterEmail} · reason: {sel.reason || '—'}</div>
      <table><tbody>
        <tr><td className="muted">Requested</td><td>{fmt(sel.requestedAt)}</td></tr>
        <tr><td className="muted">Owner decision</td><td>{sel.ownerDecision ? `${sel.ownerDecision} · ${fmt(sel.ownerDecidedAt)}` : 'not yet'}</td></tr>
        <tr><td className="muted">Waiting period</td><td>{elapsed ? <span className="pill p-good">elapsed</span> : <>ends {fmt(sel.pendingUntil)} <span className="pill p-warn" style={{ marginLeft: 6 }}>waiting</span></>}</td></tr>
        {sel.accessExpiresAt && <tr><td className="muted">Access window</td><td>{fmt(sel.accessGrantedAt)} → {fmt(sel.accessExpiresAt)}</td></tr>}
        {sel.securityReviewedAt && <tr><td className="muted">Reviewed</td><td>{fmt(sel.securityReviewedAt)}</td></tr>}
      </tbody></table>
    </Card>

    {canReview && <Card title="Security review & due diligence">
      {!elapsed && <div className="card" style={{ background: 'var(--warn-bg)', border: 0, marginBottom: 14 }}><div className="card-b" style={{ fontSize: 13 }}>The mandatory 7-day waiting period has not elapsed. Access cannot be granted until {fmt(sel.pendingUntil)}.</div></div>}
      <div style={{ display: 'grid', gap: 8 }}>{DD_CHECKS.map(([k, label]) => <label key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={!!dd[k]} onChange={(e) => setDd({ ...dd, [k]: e.target.checked })} style={{ width: 'auto', marginTop: 3 }} />{label}
      </label>)}</div>
      <div className="section" style={{ marginTop: 16 }}>Access scope</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Choose which document categories are exposed. Leave all unticked to expose every category. Only titles and types are ever shown — never document contents.</div>
      <div className="flex" style={{ gap: 16, flexWrap: 'wrap' }}>{SCOPE_CATS.map((c) => <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, textTransform: 'capitalize' }}>
        <input type="checkbox" checked={cats.includes(c)} onChange={(e) => setCats(e.target.checked ? [...cats, c] : cats.filter((x) => x !== c))} style={{ width: 'auto', marginTop: 0 }} />{c}
      </span>)}</div>
      <div className="grid2" style={{ marginTop: 14 }}>
        <label>Access duration (days)<input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
      </div>
      <label style={{ marginTop: 8, display: 'block' }}>Review notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Record the checks performed and evidence sighted…" style={taStyle} /></label>
      <div className="flex" style={{ marginTop: 14, gap: 8 }}>
        <button className="btn" disabled={busy || !elapsed || !allChecked} onClick={() => review('approve')}>{busy ? 'Working…' : 'Grant restricted access'}</button>
        <button className="btn sec" disabled={busy} onClick={() => review('decline')}>Decline</button>
      </div>
      {!allChecked && elapsed && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>All due-diligence checks must be ticked before access can be granted.</p>}
    </Card>}

    {sel.status === 'active' && <Card title="Active access">
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Granted {fmt(sel.accessGrantedAt)}, expires {fmt(sel.accessExpiresAt)}. Scope: {((sel.accessScope as any)?.categories ?? []).join(', ') || 'all categories'}.</div>
      <button className="btn sec" disabled={busy} onClick={() => revoke(sel.id)}>Revoke access now</button>
    </Card>}

    {sel.securityNotes && !canReview && <Card title="Review record"><div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{sel.securityNotes}</div></Card>}
  </>; }

  return <>
    <EmergencyBanner />
    <div className="tiles">
      <Tile ic="🛡️" bg="var(--aqua-bg)" lab="Awaiting review" val={count('owner_approved')} />
      <Tile ic="🟢" bg="var(--good-bg)" lab="Active" val={count('active')} />
      <Tile ic="🕓" bg="var(--warn-bg)" lab="Awaiting owner" val={count('pending')} />
      <Tile ic="🚫" bg="var(--surface-2)" lab="Declined / revoked" val={count('security_declined') + count('owner_declined') + count('revoked')} />
    </div>
    <Card title="Emergency access requests">
      <table><thead><tr><th>Requester</th><th>Reason</th><th>Requested</th><th>Status</th></tr></thead>
        <tbody>{reqs.map((r: any) => { const m = emMeta(r.status); return <tr key={r.id} onClick={() => pick(r)} style={{ cursor: 'pointer' }}>
          <td><b>{r.requesterName}</b><div className="muted" style={{ fontSize: 12 }}>{r.requesterEmail}</div></td>
          <td style={{ maxWidth: 240 }}>{r.reason || '—'}</td>
          <td>{fmt(r.requestedAt)}</td>
          <td><span className={`pill ${m.pill}`}>{m.label}</span></td>
        </tr>; })}</tbody></table>
      {!reqs.length && <div className="empty">No emergency access requests on the platform.</div>}
    </Card>
  </>;
}

/* ---------------- Reporting & analytics ---------------- */
// Lightweight, dependency-free inline SVG charts.
const CHART_W = 640, CHART_H = 180, PAD = 24;
function LineChart({ data, lines }: { data: any[]; lines: { k: string; color: string; label: string }[] }) {
  const n = data.length || 1;
  const max = Math.max(1, ...data.flatMap((d) => lines.map((l) => d[l.k] ?? 0)));
  const x = (i: number) => PAD + (i * (CHART_W - PAD * 2)) / Math.max(1, n - 1);
  const y = (v: number) => CHART_H - PAD - (v * (CHART_H - PAD * 2)) / max;
  const path = (k: string) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[k] ?? 0).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(max / 2), max];
  return <div>
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', height: 'auto' }}>
      {ticks.map((t) => <g key={t}><line x1={PAD} x2={CHART_W - PAD} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} /><text x={4} y={y(t) + 3} fontSize={9} fill="var(--muted)">{t}</text></g>)}
      {lines.map((l) => <g key={l.k}><path d={path(l.k)} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d[l.k] ?? 0)} r={n <= 45 ? 1.6 : 0} fill={l.color} />)}</g>)}
    </svg>
    <div className="flex" style={{ gap: 16, marginTop: 4, flexWrap: 'wrap' }}>{lines.map((l) => <span key={l.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />{l.label}</span>)}</div>
  </div>;
}
function BarChart({ data, k, color }: { data: any[]; k: string; color: string }) {
  const n = data.length || 1;
  const max = Math.max(1, ...data.map((d) => d[k] ?? 0));
  const bw = (CHART_W - PAD * 2) / n;
  const y = (v: number) => CHART_H - PAD - (v * (CHART_H - PAD * 2)) / max;
  return <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', height: 'auto' }}>
    {[0, Math.round(max / 2), max].map((t) => <g key={t}><line x1={PAD} x2={CHART_W - PAD} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} /><text x={4} y={y(t) + 3} fontSize={9} fill="var(--muted)">{t}</text></g>)}
    {data.map((d, i) => { const v = d[k] ?? 0; return <rect key={i} x={PAD + i * bw + bw * 0.15} y={y(v)} width={bw * 0.7} height={Math.max(0, CHART_H - PAD - y(v))} rx={1.5} fill={color} />; })}
  </svg>;
}
const BAR_COLORS = ['#2563eb', '#0891b2', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0284c7', '#4f46e5', '#65a30d', '#db2777', '#ca8a04', '#475569'];
function HBars({ items, fmtVal }: { items: { k: string; n: number }[]; fmtVal?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  if (!items.length) return <div className="empty">No data yet.</div>;
  return <div style={{ display: 'grid', gap: 8 }}>{items.map((it, i) => <div key={it.k}>
    <div className="flex" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}><span style={{ textTransform: 'capitalize' }}>{it.k.replace(/_/g, ' ')}</span><b>{fmtVal ? fmtVal(it.n) : it.n}</b></div>
    <div style={{ background: 'var(--surface-2)', borderRadius: 6, height: 8 }}><div style={{ width: `${(it.n / max) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length], height: 8, borderRadius: 6 }} /></div>
  </div>)}</div>;
}

function AdminReports() {
  const [range, setRange] = useState(30);
  const { data } = useData(() => api.adminAnalytics(range), [range]);
  if (!data) return <Card title="Analytics"><div className="empty">Loading analytics…</div></Card>;
  const k = data.kpis ?? {};
  const series = data.series ?? [];
  const b = data.breakdowns ?? {};
  const gbpv = (pence: number) => gbp(pence);

  function exportCsv() {
    const head = 'date,new_users,new_customers,documents,activity_events';
    const rows = series.map((d: any) => `${d.d},${d.users},${d.tenants},${d.documents},${d.events}`);
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `vaulmo-analytics-${range}d.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return <>
    <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
      <div className="flex" style={{ gap: 6 }}>{[7, 30, 90].map((r) => <button key={r} className={`btn sm ${range === r ? '' : 'sec'}`} onClick={() => setRange(r)}>{r} days</button>)}</div>
      <button className="btn sm sec" onClick={exportCsv}>Export CSV</button>
    </div>

    <div className="tiles">
      <Tile ic="🏠" bg="var(--brand-soft)" lab="Customers" val={k.customers} note={`+${k.newCustomers} in ${range}d`} />
      <Tile ic="👤" bg="var(--aqua-bg)" lab="Users" val={k.users} note={`+${k.newUsers} in ${range}d`} />
      <Tile ic="⚡" bg="var(--good-bg)" lab={`Active users (${range}d)`} val={k.activeUsers} note={`${k.users ? Math.round((k.activeUsers / k.users) * 100) : 0}% of users`} />
      <Tile ic="💷" bg="var(--warn-bg)" lab="Annual revenue" val={gbpv(k.arr ?? 0)} note={`${k.activeSubscriptions} active subs`} />
    </div>
    <div className="tiles">
      <Tile ic="📄" bg="var(--brand-soft)" lab="Documents" val={k.documents} />
      <Tile ic="🔐" bg="var(--aqua-bg)" lab="MFA adoption" val={`${k.mfaAdoptionPct}%`} note={`${k.mfaUsers} users`} />
      <Tile ic="💬" bg="var(--warn-bg)" lab="Open tickets" val={k.openTickets} />
      <Tile ic="📈" bg="var(--good-bg)" lab={`New sign-ups (${range}d)`} val={k.newUsers} />
    </div>

    <Card title="Growth">
      <LineChart data={series} lines={[{ k: 'users', color: '#2563eb', label: 'New users' }, { k: 'tenants', color: '#059669', label: 'New customers' }]} />
    </Card>
    <div className="grid2">
      <Card title="Documents added"><BarChart data={series} k="documents" color="#0891b2" /></Card>
      <Card title="Platform activity (events/day)"><BarChart data={series} k="events" color="#7c3aed" /></Card>
    </div>

    <div className="grid2">
      <Card title="Customers by plan"><HBars items={b.plans ?? []} /></Card>
      <Card title="Documents by type"><HBars items={b.documentTypes ?? []} /></Card>
    </div>
    <div className="grid2">
      <Card title="Subscriptions by status"><HBars items={b.subscriptions ?? []} /></Card>
      <Card title="Support tickets by status"><HBars items={b.tickets ?? []} /></Card>
    </div>

    <Card title="Most active households (by documents stored)">
      <table><thead><tr><th>Household</th><th>Documents</th><th>Members</th></tr></thead>
        <tbody>{(data.usage?.topTenants ?? []).map((t: any, i: number) => <tr key={i}><td><b>{t.k}</b></td><td>{t.documents}</td><td>{t.members}</td></tr>)}</tbody></table>
      {!(data.usage?.topTenants ?? []).length && <div className="empty">No usage data yet.</div>}
    </Card>
  </>;
}

/* ---------------- CRM + troubleshooting ---------------- */
const CRM_STAGES = ['lead', 'onboarding', 'active', 'at_risk', 'churned'];
const crmStagePill = (s: string) => ({ lead: 'p-info', onboarding: 'p-warn', active: 'p-good', at_risk: 'p-crit', churned: 'p-neutral' } as any)[s] ?? 'p-neutral';
const stageLabel = (s: string) => s.replace('_', ' ');

function AccountInspector({ snap }: { snap: any }) {
  const c = snap.counts ?? {};
  return <>
    <div className="card" style={{ background: 'var(--warn-bg)', border: 0, marginBottom: 14 }}><div className="card-b" style={{ fontSize: 13 }}>
      <b>Read-only support view.</b> Document contents are never shown here — only titles, types and status. This inspection has been recorded in the audit log.
    </div></div>
    <div className="tiles">
      <Tile ic="📄" bg="var(--brand-soft)" lab="Documents" val={c.documents ?? 0} />
      <Tile ic="⏰" bg="var(--aqua-bg)" lab="Reminders" val={c.reminders ?? 0} />
      <Tile ic="👪" bg="var(--good-bg)" lab="Family" val={c.family ?? 0} />
      <Tile ic="💬" bg="var(--warn-bg)" lab="Tickets" val={c.tickets ?? 0} />
    </div>
    <Card title="Members">
      {(snap.members ?? []).map((m: any) => <div className="row" key={m.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{(m.roles ?? []).includes('tenant_owner') ? '👑' : '👤'}</div>
        <div className="m"><div className="t">{m.fullName} <span className="muted" style={{ fontSize: 12 }}>· {m.email}</span></div><div className="s">{(m.roles ?? []).join(', ') || 'member'} · {m.mfaEnabled ? 'MFA on' : 'MFA off'} · {m.lastLoginAt ? 'last in ' + fmt(m.lastLoginAt) : 'never signed in'}</div></div>
        <span className={`pill ${m.status === 'ACTIVE' ? 'p-good' : 'p-neutral'}`}>{m.status}</span></div>)}
    </Card>
    <div className="grid2">
      <Card title="Documents (titles only)">
        <table><thead><tr><th>Title</th><th>Type</th><th>Status</th></tr></thead>
          <tbody>{(snap.documents ?? []).slice(0, 30).map((d: any) => <tr key={d.id}><td>{d.title}</td><td style={{ textTransform: 'capitalize' }}>{(d.typeKey ?? '—').replace(/_/g, ' ')}</td><td>{d.status}</td></tr>)}</tbody></table>
        {!(snap.documents ?? []).length && <div className="empty">No documents.</div>}
      </Card>
      <Card title="Reminders">
        <table><thead><tr><th>Title</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>{(snap.reminders ?? []).slice(0, 30).map((r: any) => <tr key={r.id}><td>{r.title}</td><td>{r.dueDate ? fmt(r.dueDate) : '—'}</td><td>{r.status}</td></tr>)}</tbody></table>
        {!(snap.reminders ?? []).length && <div className="empty">No reminders.</div>}
      </Card>
    </div>
    <div className="grid2">
      <Card title="Family & next of kin">
        {(snap.family ?? []).map((f: any) => <div className="row" key={f.id}><div className="m"><div className="t">{f.name}</div><div className="s">{f.relationship ?? 'family'}{f.isDependant ? ' · dependant' : ''}</div></div></div>)}
        {(snap.nextOfKin ?? []).map((n: any) => <div className="row" key={n.id}><div className="m"><div className="t">{n.name} <span className="muted" style={{ fontSize: 12 }}>· NoK</span></div><div className="s">{n.email}</div></div><span className={`pill ${n.status === 'confirmed' ? 'p-good' : 'p-neutral'}`}>{n.status}</span></div>)}
        {!(snap.family ?? []).length && !(snap.nextOfKin ?? []).length && <div className="empty">No family or next of kin.</div>}
      </Card>
      <Card title="Recent activity">
        {(snap.recentActivity ?? []).slice(0, 12).map((l: any) => <div className="row" key={l.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{l.outcome === 'failure' ? '⚠️' : '•'}</div><div className="m"><div className="t">{l.action}</div><div className="s">{fmt(l.at)}</div></div></div>)}
        {!(snap.recentActivity ?? []).length && <div className="empty">No recent activity.</div>}
      </Card>
    </div>
  </>;
}

function AdminCRM({ toast }: any) {
  const { data, reload } = useData(() => api.adminCrm());
  const [sel, setSel] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [inspect, setInspect] = useState<any>(null);
  const [tab, setTab] = useState<'crm' | 'inspect'>('crm');
  const [note, setNote] = useState('');
  const [noteKind, setNoteKind] = useState('note');
  const [tagsInput, setTagsInput] = useState('');
  const [busy, setBusy] = useState(false);
  const customers = data?.customers ?? [];
  const pipeline = data?.pipeline ?? {};

  async function openCustomer(c: any) { setSel(c); setTab('crm'); setInspect(null); const d = await api.adminCrmProfile(c.id); setDetail(d); setTagsInput((d.profile?.tags ?? []).join(', ')); }
  async function setStage(stage: string) { await api.adminCrmUpdate(sel.id, { stage }); toast('Stage updated'); const d = await api.adminCrmProfile(sel.id); setDetail(d); await reload(); }
  async function saveTags() { const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean); await api.adminCrmUpdate(sel.id, { tags }); toast('Tags saved'); const d = await api.adminCrmProfile(sel.id); setDetail(d); setTagsInput((d.profile?.tags ?? []).join(', ')); }
  async function addNote() { if (!note.trim()) return; await api.adminCrmNote(sel.id, { body: note, kind: noteKind }); setNote(''); setDetail(await api.adminCrmProfile(sel.id)); toast('Logged'); }
  async function openInspect() { setBusy(true); try { setInspect(await api.adminInspect(sel.id)); setTab('inspect'); } catch (e) { toast((e as any).message); } finally { setBusy(false); } }

  if (sel && detail) return <>
    <a onClick={() => { setSel(null); setDetail(null); setInspect(null); }} style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>← All customers</a>
    <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 14px' }}>
      <div><h2 style={{ margin: 0 }}>{sel.name}</h2><div className="muted" style={{ fontSize: 13 }}>{sel.plan} · joined {fmt(sel.createdAt)}</div></div>
      <div className="flex" style={{ gap: 6 }}>
        <button className={`btn sm ${tab === 'crm' ? '' : 'sec'}`} onClick={() => setTab('crm')}>CRM</button>
        <button className={`btn sm ${tab === 'inspect' ? '' : 'sec'}`} onClick={() => (inspect ? setTab('inspect') : openInspect())}>{busy ? 'Loading…' : 'Inspect account'}</button>
      </div>
    </div>
    {tab === 'inspect' && inspect ? <AccountInspector snap={inspect} /> : <>
      <div className="grid2">
        <Card title="Lifecycle stage">
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>{CRM_STAGES.map((s) => <button key={s} className={`btn sm ${detail.profile?.stage === s ? '' : 'sec'}`} style={{ textTransform: 'capitalize' }} onClick={() => setStage(s)}>{stageLabel(s)}</button>)}</div>
        </Card>
        <Card title="Tags & account owner">
          <label>Tags (comma-separated)<input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="vip, uk, referral" onBlur={saveTags} /></label>
          <div className="flex" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>{(detail.profile?.tags ?? []).map((t: string) => <span key={t} className="pill p-neutral">{t}</span>)}</div>
        </Card>
      </div>
      <Card title="Notes & contact log" right={<span className="muted" style={{ fontSize: 12 }}>{(detail.notes ?? []).length} entries</span>}>
        <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
          <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)} style={{ marginTop: 0, maxWidth: 120 }}><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select>
          <input placeholder="Add a note or log a contact…" value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 0 }} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }} />
          <button className="btn" onClick={addNote}>Add</button>
        </div>
        {(detail.notes ?? []).map((n: any) => <div className="row" key={n.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{n.kind === 'call' ? '📞' : n.kind === 'email' ? '✉️' : n.kind === 'meeting' ? '🤝' : '📝'}</div><div className="m"><div className="t" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div><div className="s">{n.authorName} · {fmt(n.createdAt)}</div></div></div>)}
        {!(detail.notes ?? []).length && <div className="empty">No notes yet. Log your first interaction above.</div>}
      </Card>
    </>}
  </>;

  return <>
    <div className="tiles">
      {CRM_STAGES.map((s) => <Tile key={s} ic={s === 'at_risk' ? '⚠️' : s === 'churned' ? '💤' : s === 'lead' ? '✨' : s === 'onboarding' ? '🚀' : '✅'} bg="var(--surface-2)" lab={stageLabel(s)} val={pipeline[s] ?? 0} />)}
    </div>
    <Card title="Customers">
      <table><thead><tr><th>Customer</th><th>Plan</th><th>Stage</th><th>Tags</th><th>Owner</th></tr></thead>
        <tbody>{customers.map((c: any) => <tr key={c.id} onClick={() => openCustomer(c)} style={{ cursor: 'pointer' }}>
          <td><b>{c.name}</b><div className="muted" style={{ fontSize: 12 }}>joined {fmt(c.createdAt)}</div></td>
          <td style={{ textTransform: 'capitalize' }}>{c.plan}</td>
          <td><span className={`pill ${crmStagePill(c.stage)}`} style={{ textTransform: 'capitalize' }}>{stageLabel(c.stage)}</span></td>
          <td>{(c.tags ?? []).slice(0, 3).map((t: string) => <span key={t} className="pill p-neutral" style={{ marginRight: 4 }}>{t}</span>)}</td>
          <td>{c.ownerName ?? '—'}</td>
        </tr>)}</tbody></table>
      {!customers.length && <div className="empty">No customers yet.</div>}
    </Card>
  </>;
}

/* ---------------- CMS / knowledge base ---------------- */
function AdminCMS({ toast }: any) {
  const { data, reload } = useData(() => api.adminArticles());
  const [edit, setEdit] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const articles = data?.articles ?? [];

  function startNew() { setConfirmDel(false); setEdit({ title: '', slug: '', category: '', excerpt: '', body: '', status: 'draft', isNew: true }); }
  function openEdit(a: any) { setConfirmDel(false); setEdit({ ...a, isNew: false }); }
  async function save() {
    if (!edit.title.trim()) { toast('Title is required'); return; }
    setBusy(true);
    try {
      const payload = { title: edit.title, slug: edit.slug || undefined, category: edit.category || undefined, excerpt: edit.excerpt || undefined, body: edit.body || '', status: edit.status };
      if (edit.isNew) await api.adminCreateArticle(payload); else await api.adminUpdateArticle(edit.id, payload);
      toast('Saved'); setEdit(null); await reload();
    } catch (e) { toast((e as any).message); } finally { setBusy(false); }
  }
  async function togglePublish(a: any) { await api.adminUpdateArticle(a.id, { status: a.status === 'published' ? 'draft' : 'published' }); toast(a.status === 'published' ? 'Unpublished' : 'Published'); await reload(); }
  async function del() { if (!confirmDel) { setConfirmDel(true); return; } await api.adminDeleteArticle(edit.id); toast('Deleted'); setEdit(null); await reload(); }

  if (edit) return <>
    <a onClick={() => setEdit(null)} style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>← All articles</a>
    <div style={{ height: 10 }} />
    <Card title={edit.isNew ? 'New article' : `Edit · ${edit.title}`} right={<span className={`pill ${edit.status === 'published' ? 'p-good' : 'p-neutral'}`}>{edit.status}</span>}>
      <div className="grid2">
        <label>Title<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="How to add a document" /></label>
        <label>Category<input value={edit.category ?? ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Getting started" /></label>
      </div>
      <label>Short summary<input value={edit.excerpt ?? ''} onChange={(e) => setEdit({ ...edit, excerpt: e.target.value })} placeholder="One line shown in the help centre list" /></label>
      <label style={{ display: 'block', marginTop: 8 }}>Body<textarea value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={12} placeholder="Write the article. Plain text and line breaks are preserved." style={taStyle} /></label>
      <div className="flex" style={{ marginTop: 14, gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} style={{ marginTop: 0, maxWidth: 150 }}><option value="draft">Draft</option><option value="published">Published</option></select>
        </div>
        {!edit.isNew && <button className={`btn sm ${confirmDel ? '' : 'sec'}`} onClick={del}>{confirmDel ? 'Click to confirm delete' : 'Delete'}</button>}
      </div>
    </Card>
  </>;

  const published = articles.filter((a: any) => a.status === 'published').length;
  return <>
    <div className="tiles">
      <Tile ic="📚" bg="var(--brand-soft)" lab="Articles" val={articles.length} />
      <Tile ic="✅" bg="var(--good-bg)" lab="Published" val={published} />
      <Tile ic="📝" bg="var(--warn-bg)" lab="Drafts" val={articles.length - published} />
      <Tile ic="👁️" bg="var(--aqua-bg)" lab="Total views" val={articles.reduce((s: number, a: any) => s + (a.views ?? 0), 0)} />
    </div>
    <Card title="Articles" right={<a onClick={startNew} style={{ cursor: 'pointer', color: 'var(--brand)' }}>+ New article</a>}>
      <table><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Views</th><th>Updated</th><th></th></tr></thead>
        <tbody>{articles.map((a: any) => <tr key={a.id}>
          <td onClick={() => openEdit(a)} style={{ cursor: 'pointer' }}><b>{a.title}</b><div className="muted" style={{ fontSize: 12 }}>/{a.slug}</div></td>
          <td>{a.category ?? '—'}</td>
          <td><span className={`pill ${a.status === 'published' ? 'p-good' : 'p-neutral'}`}>{a.status}</span></td>
          <td>{a.views ?? 0}</td>
          <td>{fmt(a.updatedAt)}</td>
          <td><button className="btn sm sec" onClick={() => togglePublish(a)}>{a.status === 'published' ? 'Unpublish' : 'Publish'}</button></td>
        </tr>)}</tbody></table>
      {!articles.length && <div className="empty">No articles yet. Write your first help article.</div>}
    </Card>
  </>;
}

function HelpCenter() {
  const { data } = useData(() => api.helpArticles());
  const [sel, setSel] = useState<any>(null);
  const articles = data?.articles ?? [];
  async function open(slug: string) { setSel(await api.helpArticle(slug)); }
  const byCat = new Map<string, any[]>();
  for (const a of articles) { const c = a.category || 'General'; byCat.set(c, [...(byCat.get(c) ?? []), a]); }

  if (sel) return <>
    <a onClick={() => setSel(null)} style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>← Back to Help Centre</a>
    <div style={{ height: 10 }} />
    <Card title={sel.article.title}>
      {sel.article.category && <div className="muted" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 10 }}>{sel.article.category}</div>}
      <div style={{ fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{sel.article.body}</div>
    </Card>
  </>;

  return <>
    {[...byCat.entries()].map(([cat, list]) => <Card key={cat} title={cat}>
      {list.map((a: any) => <div className="row" key={a.id} onClick={() => open(a.slug)} style={{ cursor: 'pointer' }}><div className="ic" style={{ background: 'var(--surface-2)' }}>📄</div><div className="m"><div className="t">{a.title}</div><div className="s">{a.excerpt ?? ''}</div></div><span className="muted" style={{ fontSize: 18 }}>›</span></div>)}
    </Card>)}
    {!articles.length && <Card title="Help Centre"><div className="empty">No articles published yet. Check back soon.</div></Card>}
  </>;
}

/* ---------------- Security dashboard ---------------- */
const secIcon = (a: string) => (a.startsWith('emergency') ? '🛡️' : a === 'authz.denied' ? '🚫' : a.startsWith('mfa') ? '🔐' : a.includes('login') ? '🔑' : a.includes('suspend') || a.includes('sessions_revoked') ? '⛔' : '•');
function AdminSecurity({ toast }: any) {
  const { data, reload } = useData(() => api.adminSecurity());
  const [busy, setBusy] = useState('');
  const k = data?.kpis ?? {};
  const locked = data?.lockedAccounts ?? [];
  const events = data?.recentEvents ?? [];
  async function unlock(id: string) { setBusy(id); try { await api.adminSetUserStatus(id, { status: 'ACTIVE' }); toast('Account unlocked'); await reload(); } catch (e) { toast((e as any).message); } finally { setBusy(''); } }
  async function revoke(id: string) { setBusy(id); try { const r = await api.adminRevokeUserSessions(id); toast(`Revoked ${r.revoked} session${r.revoked === 1 ? '' : 's'}`); } catch (e) { toast((e as any).message); } finally { setBusy(''); } }
  return <>
    <div className="tiles">
      <Tile ic="🔑" bg="var(--warn-bg)" lab="Failed logins (7d)" val={k.failedLogins7d ?? 0} />
      <Tile ic="🔒" bg="var(--crit-bg)" lab="Active lockouts" val={k.activeLockouts ?? 0} />
      <Tile ic="🚫" bg="var(--surface-2)" lab="Access denials (7d)" val={k.authzDenials7d ?? 0} />
      <Tile ic="⛔" bg="var(--crit-bg)" lab="Suspended accounts" val={k.suspendedAccounts ?? 0} />
    </div>
    <div className="tiles">
      <Tile ic="🛡️" bg="var(--aqua-bg)" lab="Emergency events (7d)" val={k.emergencyEvents7d ?? 0} />
      <Tile ic="⚙️" bg="var(--brand-soft)" lab="Admin actions (7d)" val={k.adminActions7d ?? 0} />
    </div>
    <div className="grid2">
      <Card title="Locked-out accounts">
        {locked.map((u: any) => <div className="row" key={u.id}><div className="ic" style={{ background: 'var(--crit-bg)' }}>🔒</div>
          <div className="m"><div className="t">{u.email}</div><div className="s">{u.failedLoginCount} failed attempts · until {fmt(u.lockedUntil)}</div></div>
          <button className="btn sm sec" disabled={busy === u.id} onClick={() => unlock(u.id)}>Unlock</button></div>)}
        {!locked.length && <div className="empty">No accounts are currently locked.</div>}
      </Card>
      <Card title="Recent security events">
        {events.slice(0, 18).map((e: any) => <div className="row" key={e.id}><div className="ic" style={{ background: 'var(--surface-2)' }}>{secIcon(e.action)}</div>
          <div className="m"><div className="t">{e.action}{e.outcome === 'failure' ? ' · failed' : ''}</div><div className="s">{e.actor ?? 'system'} · {e.ip ?? 'no ip'} · {fmt(e.at)}</div></div></div>)}
        {!events.length && <div className="empty">No recent security events.</div>}
      </Card>
    </div>
  </>;
}

/* ---------------- Admins & Roles ---------------- */
const ADMIN_ROLE_OPTS = [{ key: 'super_admin', label: 'Super Admin' }, { key: 'security_reviewer', label: 'Security Reviewer' }, { key: 'support_agent', label: 'Support Agent' }];
const roleLabel = (k: string) => ADMIN_ROLE_OPTS.find((r) => r.key === k)?.label ?? k;
function AdminRoles({ toast, me }: any) {
  const { data: adminsData, reload } = useData(() => api.adminAdmins());
  const { data: rolesData } = useData(() => api.adminRoles());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ email: '', fullName: '', password: '', role: 'support_agent' });
  const [editRoles, setEditRoles] = useState<Record<string, string[]>>({});
  const admins = adminsData?.admins ?? [];
  const roles = rolesData?.roles ?? [];

  async function create() {
    if (!form.email || !form.fullName || !form.password) { toast('Email, name and a temporary password are required'); return; }
    try { await api.adminCreateAdmin(form); toast('Admin created'); setAdding(false); setForm({ email: '', fullName: '', password: '', role: 'support_agent' }); await reload(); }
    catch (e) { toast((e as any).message); }
  }
  async function saveRoles(id: string) {
    const roleKeys = editRoles[id] ?? [];
    try { await api.adminSetAdminRoles(id, roleKeys); toast('Roles updated'); setEditRoles((s) => { const n = { ...s }; delete n[id]; return n; }); await reload(); }
    catch (e) { toast((e as any).message); }
  }
  async function setStatus(id: string, status: string) {
    try { await api.adminSetUserStatus(id, { status }); toast(status === 'ACTIVE' ? 'Reactivated' : 'Suspended'); await reload(); }
    catch (e) { toast((e as any).message); }
  }
  function toggleRole(id: string, current: string[], key: string) {
    const base = editRoles[id] ?? current;
    const next = base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    setEditRoles((s) => ({ ...s, [id]: next }));
  }

  return <>
    <Card title="Administrator accounts" right={<a onClick={() => setAdding(!adding)} style={{ cursor: 'pointer', color: 'var(--brand-2)' }}>{adding ? 'Cancel' : '+ New admin'}</a>}>
      {adding && <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14, marginBottom: 12 }}>
        <div className="grid2">
          <label>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@vaulmo.com" /></label>
          <label>Full name<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Jordan Smith" /></label>
          <label>Temporary password<input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 10 characters" /></label>
          <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ADMIN_ROLE_OPTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        </div>
        <button className="btn" style={{ marginTop: 10 }} onClick={create}>Create admin</button>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>The new administrator must set up two-factor authentication on first sign-in — it's mandatory for all admin accounts.</p>
      </div>}
      <table><thead><tr><th>Admin</th><th>Roles</th><th>2FA</th><th>Status</th><th>Last active</th><th></th></tr></thead>
        <tbody>{admins.map((a: any) => { const cur = editRoles[a.id] ?? a.roles; const dirty = !!editRoles[a.id]; return <tr key={a.id}>
          <td><b>{a.fullName}</b><div className="muted" style={{ fontSize: 12 }}>{a.email}</div></td>
          <td><div className="flex" style={{ gap: 4, flexWrap: 'wrap' }}>{ADMIN_ROLE_OPTS.map((r) => <button key={r.key} className={`pill ${cur.includes(r.key) ? 'p-info' : 'p-neutral'}`} style={{ cursor: 'pointer' }} onClick={() => toggleRole(a.id, a.roles, r.key)}>{r.label}</button>)}{dirty && <button className="btn sm" onClick={() => saveRoles(a.id)}>Save</button>}</div></td>
          <td>{a.mfaEnabled ? <span className="pill p-good">on</span> : <span className="pill p-warn">off</span>}</td>
          <td><span className={`pill ${a.status === 'ACTIVE' ? 'p-good' : 'p-crit'}`}>{a.status}</span></td>
          <td>{a.lastLoginAt ? fmt(a.lastLoginAt) : 'never'}</td>
          <td>{a.id !== me?.id && (a.status === 'ACTIVE' ? <button className="btn sm sec" onClick={() => setStatus(a.id, 'SUSPENDED')}>Suspend</button> : <button className="btn sm sec" onClick={() => setStatus(a.id, 'ACTIVE')}>Reactivate</button>)}</td>
        </tr>; })}</tbody></table>
      {!admins.length && <div className="empty">No administrators yet.</div>}
    </Card>

    <div className="section">Roles & permissions</div>
    {roles.filter((r: any) => r.isAdmin).map((r: any) => <Card key={r.id} title={r.name} right={<span className="muted" style={{ fontSize: 12 }}>{r.members} member{r.members === 1 ? '' : 's'}</span>}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{r.description}</div>
      <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>{r.permissions.map((p: string) => <span key={p} className="pill p-neutral" style={{ fontFamily: 'monospace', fontSize: 11 }}>{p}</span>)}</div>
    </Card>)}
    <p className="muted" style={{ fontSize: 12.5 }}>Roles follow least privilege: a Security Reviewer can review emergency cases and monitor security but cannot manage billing or content; a Support Agent handles tickets and sees non-sensitive account information only. Two-factor authentication is mandatory for every administrator.</p>
  </>;
}

/* ---------------- Document Catalogue (configuration) ---------------- */
const FIELD_TYPES = ['string', 'date', 'number'];
function AdminCatalogue({ toast }: any) {
  const { data, reload } = useData(() => api.adminCatalogue());
  const [edit, setEdit] = useState<any>(null);
  const [showArchived, setShowArchived] = useState(false);
  const types = data?.types ?? [];
  const shown = types.filter((t: any) => showArchived || !t.archived);
  const byCat = new Map<string, any[]>();
  for (const t of shown) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);

  function startNew() { setEdit({ isNew: true, name: '', category: '', countriesStr: 'GLOBAL', recommended: true, sort: 100, reminderStr: '180, 90, 30, 7', metadataSchema: [] }); }
  function openEdit(t: any) { setEdit({ isNew: false, id: t.id, key: t.key, name: t.name, category: t.category, countriesStr: (t.countries ?? []).join(', '), recommended: t.recommended, sort: t.sort, reminderStr: (t.reminderLeadDays ?? []).join(', '), metadataSchema: (t.metadataSchema ?? []).map((f: any) => ({ ...f })), archived: t.archived }); }
  function toArr(s: string) { return s.split(',').map((x) => x.trim()).filter(Boolean); }
  async function save() {
    if (!edit.name.trim() || !edit.category.trim()) { toast('Name and category are required'); return; }
    const payload = {
      name: edit.name, category: edit.category,
      countries: toArr(edit.countriesStr).map((c) => c.toUpperCase()),
      recommended: !!edit.recommended, sort: Number(edit.sort) || 100,
      reminderLeadDays: toArr(edit.reminderStr).map(Number).filter((n) => !isNaN(n)),
      metadataSchema: edit.metadataSchema.filter((f: any) => f.key && f.label),
    };
    try {
      if (edit.isNew) await api.adminCreateDocType(payload); else await api.adminUpdateDocType(edit.id, payload);
      toast('Saved'); setEdit(null); await reload();
    } catch (e) { toast((e as any).message); }
  }
  async function archive(t: any) { try { await api.adminArchiveDocType(t.id, !t.archived); toast(t.archived ? 'Restored' : 'Archived'); await reload(); } catch (e) { toast((e as any).message); } }
  function addField() { setEdit({ ...edit, metadataSchema: [...edit.metadataSchema, { key: '', label: '', type: 'string', required: false }] }); }
  function setField(i: number, patch: any) { const m = edit.metadataSchema.slice(); m[i] = { ...m[i], ...patch }; setEdit({ ...edit, metadataSchema: m }); }
  function delField(i: number) { setEdit({ ...edit, metadataSchema: edit.metadataSchema.filter((_: any, j: number) => j !== i) }); }

  if (edit) return <>
    <a onClick={() => setEdit(null)} style={{ cursor: 'pointer', color: 'var(--brand-2)', fontSize: 13 }}>← All document types</a>
    <div style={{ height: 10 }} />
    <Card title={edit.isNew ? 'New document type' : `Edit · ${edit.name}`} right={edit.recommended ? <span className="pill p-good">recommended</span> : undefined}>
      <div className="grid2">
        <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Passport" /></label>
        <label>Category<input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="Identity" /></label>
        <label>Countries (comma-separated, or GLOBAL)<input value={edit.countriesStr} onChange={(e) => setEdit({ ...edit, countriesStr: e.target.value })} placeholder="GB, US or GLOBAL" /></label>
        <label>Sort order<input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: e.target.value })} /></label>
      </div>
      <label style={{ display: 'block', marginTop: 8 }}>Reminder schedule — days before expiry<input value={edit.reminderStr} onChange={(e) => setEdit({ ...edit, reminderStr: e.target.value })} placeholder="180, 90, 30, 7" /></label>
      <div className="flex" style={{ marginTop: 12, alignItems: 'center', gap: 8 }}><input type="checkbox" checked={edit.recommended} onChange={(e) => setEdit({ ...edit, recommended: e.target.checked })} style={{ width: 'auto', marginTop: 0 }} /><span style={{ fontSize: 14 }}>Recommend this document to users (shows in their checklist)</span></div>

      <div className="section">Metadata to extract <a onClick={addField} style={{ float: 'right', fontSize: 13, cursor: 'pointer', color: 'var(--brand-2)' }}>+ Add field</a></div>
      <table><thead><tr><th>Field key</th><th>Label</th><th>Type</th><th>Required</th><th></th></tr></thead>
        <tbody>{edit.metadataSchema.map((f: any, i: number) => <tr key={i}>
          <td><input value={f.key} onChange={(e) => setField(i, { key: e.target.value })} placeholder="expiryDate" style={{ marginTop: 0 }} /></td>
          <td><input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Expiry date" style={{ marginTop: 0 }} /></td>
          <td><select value={f.type} onChange={(e) => setField(i, { type: e.target.value })} style={{ marginTop: 0, maxWidth: 120 }}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
          <td><input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} style={{ width: 'auto', marginTop: 0 }} /></td>
          <td><button className="btn sm sec" onClick={() => delField(i)}>Remove</button></td>
        </tr>)}</tbody></table>
      {!edit.metadataSchema.length && <div className="empty">No metadata fields. Add fields Vaulmo should try to extract (e.g. expiry date, policy number).</div>}

      <div className="flex" style={{ marginTop: 16, gap: 8 }}>
        <button className="btn" onClick={save}>{edit.isNew ? 'Create type' : 'Save changes'}</button>
        {!edit.isNew && <button className={`btn sm sec`} onClick={() => archive({ id: edit.id, archived: edit.archived })}>{edit.archived ? 'Restore' : 'Archive'}</button>}
      </div>
    </Card>
  </>;

  const active = types.filter((t: any) => !t.archived);
  return <>
    <div className="tiles">
      <Tile ic="📚" bg="var(--brand-soft)" lab="Document types" val={active.length} />
      <Tile ic="⭐" bg="var(--good-bg)" lab="Recommended" val={active.filter((t: any) => t.recommended).length} />
      <Tile ic="🗂️" bg="var(--aqua-bg)" lab="Categories" val={(data?.categories ?? []).length} />
      <Tile ic="🌍" bg="var(--warn-bg)" lab="Countries covered" val={(data?.countries ?? []).length} />
    </div>
    <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 'auto', marginTop: 0 }} /> Show archived</span>
      <button className="btn sm" onClick={startNew}>+ New document type</button>
    </div>
    {[...byCat.entries()].map(([cat, list]) => <Card key={cat} title={cat}>
      <table><thead><tr><th>Document</th><th>Countries</th><th>Fields</th><th>Reminders (days)</th><th>In use</th><th></th></tr></thead>
        <tbody>{list.sort((a: any, b: any) => a.sort - b.sort).map((t: any) => <tr key={t.id} style={{ opacity: t.archived ? 0.55 : 1 }}>
          <td onClick={() => openEdit(t)} style={{ cursor: 'pointer' }}><b>{t.name}</b>{t.recommended && <span className="pill p-good" style={{ marginLeft: 8 }}>recommended</span>}{t.archived && <span className="pill p-neutral" style={{ marginLeft: 6 }}>archived</span>}<div className="muted" style={{ fontSize: 12 }}>/{t.key}</div></td>
          <td>{(t.countries ?? []).join(', ')}</td>
          <td>{(t.metadataSchema ?? []).length}</td>
          <td>{(t.reminderLeadDays ?? []).join(', ')}</td>
          <td>{t.inUse}</td>
          <td><div className="flex" style={{ gap: 6 }}><button className="btn sm sec" onClick={() => openEdit(t)}>Edit</button><button className="btn sm sec" onClick={() => archive(t)}>{t.archived ? 'Restore' : 'Archive'}</button></div></td>
        </tr>)}</tbody></table>
    </Card>)}
    {!shown.length && <div className="empty">No document types{!showArchived ? ' (archived hidden)' : ''}.</div>}
  </>;
}
