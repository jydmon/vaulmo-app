import { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, setTokens, loadTokens, uploadText, ApiError, type AuthResult } from './src/api';

type Tab = 'home' | 'vault' | 'ask' | 'connected' | 'profile';

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [screen, setScreen] = useState<'login' | 'mfa'>('login');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [form, setForm] = useState({ email: 'tester@lifehub.local', password: 'Tester123!', code: '' });
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('home');

  useEffect(() => { loadTokens().then(() => { /* could auto-login here */ }); }, []);

  async function afterAuth(r: AuthResult) {
    if (r.mfaRequired && r.challengeToken) { setChallenge(r.challengeToken); setScreen('mfa'); return; }
    if (r.accessToken && r.refreshToken) { await setTokens(r.accessToken, r.refreshToken); setMe(await api.me()); }
  }
  const submit = (fn: () => Promise<void>) => async () => { setError(''); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); } };

  if (!me) return (
    <SafeAreaView style={s.safe}><StatusBar style="dark" />
      <View style={s.login}>
        <View style={s.logo}><Text style={s.logoTxt}>V</Text></View>
        <Text style={s.h1}>{screen === 'login' ? 'Welcome to Vaulmo' : 'Two-factor code'}</Text>
        {!!error && <Text style={s.err}>{error}</Text>}
        {screen === 'login' ? <>
          <Text style={s.label}>Email</Text><TextInput style={s.input} autoCapitalize="none" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} />
          <Text style={s.label}>Password</Text><TextInput style={s.input} secureTextEntry value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} />
          <Btn label="Sign in" onPress={submit(async () => afterAuth(await api.login({ email: form.email, password: form.password })))} />
        </> : <>
          <Text style={s.label}>Authenticator code</Text><TextInput style={s.input} keyboardType="number-pad" value={form.code} onChangeText={(v) => setForm({ ...form, code: v })} />
          <Btn label="Verify" onPress={submit(async () => afterAuth(await api.loginMfa(form.code, challenge!)))} />
        </>}
      </View>
    </SafeAreaView>
  );

  const Screen = { home: Home, vault: Vault, ask: Ask, connected: Connected, profile: Profile }[tab];
  return (
    <SafeAreaView style={s.safe}><StatusBar style="dark" />
      <Screen me={me} onSignOut={async () => { await setTokens(null, null); setMe(null); }} goTab={setTab} />
      <View style={s.tabbar}>
        {([['home', '🏠', 'Home'], ['vault', '🗄️', 'Vault'], ['add', '＋', ''], ['ask', '💬', 'Ask'], ['profile', '👤', 'You']] as const).map(([id, ic, label]) =>
          id === 'add'
            ? <TouchableOpacity key={id} style={s.fab} onPress={() => setTab('vault')}><Text style={{ color: '#fff', fontSize: 26 }}>＋</Text></TouchableOpacity>
            : <TouchableOpacity key={id} style={s.tab} onPress={() => setTab(id as Tab)}><Text style={{ fontSize: 20 }}>{ic}</Text><Text style={[s.tabLabel, tab === id && { color: '#2563EB' }]}>{label}</Text></TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => { fn().then(setData).catch(() => {}); /* eslint-disable-next-line */ }, deps);
  return [data, () => fn().then(setData)] as const;
}
const fmt = (x?: string) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Home({ me }: any) {
  const [cl] = useAsync(() => api.checklist());
  const [brief] = useAsync(() => api.whatsImportant());
  const [rem] = useAsync(() => api.reminders());
  if (!cl) return <Loading />;
  return <ScrollView contentContainerStyle={s.pad}>
    <Text style={s.hi}>Welcome back</Text><Text style={s.big}>{me.fullName.split(' ')[0]}</Text>
    <View style={s.hero}><Text style={s.heroLab}>Your Vaulmo</Text><Text style={s.heroBig}>{cl.completionScore}% complete</Text><Text style={s.heroSub}>{cl.outstanding.length} recommended documents to add</Text></View>
    <View style={s.row2}><Stat v={rem?.live?.length ?? 0} l="Live reminders" /><Stat v={cl.confirmed} l="Verified docs" /></View>
    <Card><Text style={s.cardT}>What you need to know</Text><Text style={s.muted}>{brief?.summary ?? ''}</Text></Card>
    <Text style={s.sec}>Coming up</Text>
    {(rem?.live ?? []).slice(0, 5).map((r: any) => <Item key={r.id} icon="🔔" t={r.title} sub={fmt(r.dueDate)} />)}
  </ScrollView>;
}

function Vault() {
  const [docs, reload] = useAsync(() => api.documents());
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('UNITED KINGDOM\nPASSPORT\nPassport No: 546872331\nNationality: British\nDate of expiry: 22 Mar 2027');
  const [pending, setPending] = useState<any>(null);
  async function scan() { const bytes = text.length; const init = await api.createDocument({ filename: 'doc.txt', contentType: 'text/plain', sizeBytes: bytes, title: 'Document' }); await uploadText(init.uploadUrl, text); const r = await api.processDocument(init.documentId); const m: any = {}; r.extracted.forEach((f: any) => f.value && (m[f.key] = f.value)); setPending({ id: init.documentId, extracted: r.extracted, meta: m, cls: r.classification }); }
  async function confirm() { await api.confirmDocument(pending.id, pending.meta); setPending(null); setAdding(false); reload(); }
  return <ScrollView contentContainerStyle={s.pad}>
    <View style={s.spread}><Text style={s.big}>My Vault</Text><Btn small label="+ Add" onPress={() => { setAdding(true); setPending(null); }} /></View>
    {adding && <Card>
      {!pending ? <>
        <Text style={s.label}>Paste a synthetic document</Text>
        <TextInput style={[s.input, { height: 120 }]} multiline value={text} onChangeText={setText} />
        <Btn label="Scan & extract" onPress={scan} />
      </> : <>
        <Text style={s.ok}>Classified as {pending.cls?.typeKey} ({Math.round((pending.cls?.confidence ?? 0) * 100)}%)</Text>
        {pending.extracted.map((f: any) => <View key={f.key}><Text style={s.label}>{f.label}</Text><TextInput style={s.input} value={pending.meta[f.key] ?? ''} onChangeText={(v) => setPending({ ...pending, meta: { ...pending.meta, [f.key]: v } })} /></View>)}
        <Btn label="Confirm & store" onPress={confirm} />
      </>}
    </Card>}
    {(docs?.documents ?? []).map((d: any) => <Item key={d.id} icon="📄" t={d.title} sub={`${d.typeKey ?? 'unclassified'} · ${d.status}`} />)}
  </ScrollView>;
}

function Ask() {
  const [chat, setChat] = useState<any[]>([{ role: 'ai', text: 'Ask me anything about your vault.' }]);
  const [q, setQ] = useState('');
  async function ask(question: string) { if (!question.trim()) return; setChat((c) => [...c, { role: 'me', text: question }]); setQ(''); try { const r = await api.ask(question); setChat((c) => [...c, { role: 'ai', text: r.answer, sources: r.sources }]); } catch { setChat((c) => [...c, { role: 'ai', text: 'Error.' }]); } }
  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={s.pad}><Text style={s.big}>Ask Vaulmo</Text>
      {chat.map((m, i) => <View key={i} style={[s.msg, m.role === 'me' && { flexDirection: 'row-reverse' }]}><View style={[s.bub, m.role === 'me' ? s.bubMe : s.bubAi]}><Text style={m.role === 'me' ? { color: '#fff' } : {}}>{m.text}</Text>{m.sources && <Text style={s.src}>Sources: {m.sources.map((x: any) => x.ref).join(', ')}</Text>}</View></View>)}
    </ScrollView>
    <View style={s.composer}><TextInput style={[s.input, { flex: 1, marginTop: 0 }]} value={q} onChangeText={setQ} placeholder="Ask a question…" /><Btn small label="Ask" onPress={() => ask(q)} /></View>
  </View>;
}

function Connected() {
  const [conns, rc] = useAsync(() => api.connections());
  const [det, rd] = useAsync(() => api.detected());
  async function connect(p: string) { await api.connect(p); await api.callback(p, 'demo_' + Math.random().toString(36).slice(2, 8)); rc(); }
  async function sync(id: string) { await api.sync(id); rd(); }
  async function add(id: string) { await api.confirmDetected(id); rd(); }
  return <ScrollView contentContainerStyle={s.pad}>
    <Text style={s.big}>Connected</Text>
    <Card><Text style={s.cardT}>Connect a service</Text>
      {['gmail', 'outlook'].map((p) => <View key={p} style={s.spread}><Text>{p === 'gmail' ? '📧' : '📨'} {p[0].toUpperCase() + p.slice(1)}</Text><Btn small label="Connect" onPress={() => connect(p)} /></View>)}
    </Card>
    <Text style={s.sec}>Your connections</Text>
    {(conns?.connections ?? []).map((c: any) => <View key={c.id} style={s.item}><Text style={{ flex: 1 }}>🔌 {c.provider} · {c.status}</Text><Btn small label="Sync" onPress={() => sync(c.id)} /></View>)}
    <Text style={s.sec}>Detected — confirm to add</Text>
    {(det?.detected ?? []).map((i: any) => <View key={i.id} style={s.item}><Text style={{ flex: 1 }} numberOfLines={1}>{i.type === 'travel' ? '✈️' : i.type === 'purchase' ? '🧾' : '🔁'} {i.rawSubject}</Text><Btn small label="Add" onPress={() => add(i.id)} /></View>)}
  </ScrollView>;
}

function Profile({ me, onSignOut, goTab }: any) {
  const [nok] = useAsync(() => api.nok());
  const [emg] = useAsync(() => api.emergencyStatus());
  const [ent] = useAsync(() => api.entitlements().catch(() => ({ planKey: 'starter' })));
  return <ScrollView contentContainerStyle={s.pad}>
    <Text style={s.big}>You & Family</Text>
    <Card><Text style={s.cardT}>{me.fullName}</Text><Text style={s.muted}>{me.email}</Text></Card>
    <View style={[s.card, { backgroundColor: '#4a3aa7' }]}><Text style={{ color: '#fff', opacity: 0.8, fontSize: 12 }}>YOUR PLAN</Text><Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textTransform: 'capitalize' }}>{ent?.planKey ?? 'starter'}</Text></View>
    <View style={[s.banner, { backgroundColor: emg?.enabled ? '#e6f6e6' : '#fdf2d9' }]}><Text>{emg?.enabled ? '🛡️' : '⏳'} Emergency Access — {emg?.message}</Text></View>
    <Text style={s.sec}>Next of kin</Text>
    {(nok?.nextOfKin ?? []).map((n: any) => <Item key={n.id} icon="👤" t={n.name} sub={n.email} pill={n.status} />)}
    <TouchableOpacity style={s.item} onPress={() => goTab('connected')}><Text style={{ flex: 1 }}>🔌 Connected services</Text><Text>›</Text></TouchableOpacity>
    <Btn label="Sign out" secondary onPress={onSignOut} />
  </ScrollView>;
}

/* ---- primitives ---- */
const Loading = () => <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
const Btn = ({ label, onPress, small, secondary }: any) => <TouchableOpacity style={[s.btn, small && s.btnSm, secondary && s.btnSec]} onPress={onPress}><Text style={[s.btnTxt, secondary && { color: '#2563EB' }]}>{label}</Text></TouchableOpacity>;
const Card = ({ children }: any) => <View style={s.card}>{children}</View>;
const Stat = ({ v, l }: any) => <View style={s.stat}><Text style={s.statV}>{v}</Text><Text style={s.statL}>{l}</Text></View>;
const Item = ({ icon, t, sub, pill }: any) => <View style={s.item}><Text style={{ fontSize: 20, marginRight: 10 }}>{icon}</Text><View style={{ flex: 1 }}><Text style={s.itemT}>{t}</Text><Text style={s.itemS}>{sub}</Text></View>{pill && <Text style={s.pill}>{pill}</Text>}</View>;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#eef1f6' },
  login: { flex: 1, padding: 28, paddingTop: 60 },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: '#1E3A8A', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoTxt: { color: '#fff', fontWeight: '800', fontSize: 18 },
  h1: { fontSize: 22, fontWeight: '750' as any, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: '#5b6472', marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#e6eaf1', borderRadius: 11, padding: 12, fontSize: 15, marginTop: 6, backgroundColor: '#fff' },
  err: { color: '#d03b3b', marginBottom: 8 }, ok: { color: '#0ca30c', marginBottom: 8, fontWeight: '600' },
  btn: { backgroundColor: '#2563EB', borderRadius: 13, padding: 14, alignItems: 'center', marginTop: 14 },
  btnSm: { paddingVertical: 8, paddingHorizontal: 14, marginTop: 0, borderRadius: 10 },
  btnSec: { backgroundColor: '#f4f6fa' }, btnTxt: { color: '#fff', fontWeight: '700' },
  pad: { padding: 18, paddingBottom: 110 },
  hi: { fontSize: 13, color: '#5b6472', fontWeight: '600' }, big: { fontSize: 24, fontWeight: '750' as any, marginBottom: 12 },
  hero: { backgroundColor: '#2563EB', borderRadius: 20, padding: 18, marginBottom: 14 },
  heroLab: { color: '#fff', opacity: 0.85, fontSize: 12.5, fontWeight: '600' }, heroBig: { color: '#fff', fontSize: 24, fontWeight: '750' as any, marginVertical: 6 }, heroSub: { color: '#fff', opacity: 0.9, fontSize: 13 },
  row2: { flexDirection: 'row', gap: 12, marginBottom: 14 }, stat: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 15 }, statV: { fontSize: 22, fontWeight: '750' as any }, statL: { fontSize: 12, color: '#5b6472', fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 }, cardT: { fontWeight: '700', marginBottom: 6 }, muted: { color: '#5b6472', fontSize: 13.5 },
  sec: { fontSize: 16, fontWeight: '700', marginVertical: 12 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 13, marginBottom: 10 }, itemT: { fontWeight: '600', fontSize: 14.5 }, itemS: { fontSize: 12.5, color: '#5b6472' },
  pill: { fontSize: 11, fontWeight: '700', color: '#2563EB', backgroundColor: '#e7f0fb', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 20, overflow: 'hidden' },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  banner: { borderRadius: 12, padding: 12, marginBottom: 10 },
  msg: { flexDirection: 'row', marginBottom: 10 }, bub: { padding: 11, borderRadius: 14, maxWidth: '82%' }, bubAi: { backgroundColor: '#fff' }, bubMe: { backgroundColor: '#2563EB' }, src: { fontSize: 11.5, color: '#5b6472', marginTop: 5 },
  composer: { position: 'absolute', bottom: 92, left: 0, right: 0, flexDirection: 'row', gap: 8, padding: 12, backgroundColor: 'rgba(238,241,246,0.95)', alignItems: 'center' },
  tabbar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 84, flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e6eaf1', paddingTop: 10 },
  tab: { flex: 1, alignItems: 'center' }, tabLabel: { fontSize: 10.5, fontWeight: '600', color: '#8b93a1', marginTop: 2 },
  fab: { width: 54, height: 54, borderRadius: 17, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center', marginTop: -14, marginHorizontal: 6 },
});
