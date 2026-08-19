import { useEffect, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image, Modal, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, setTokens, loadTokens, hasToken, uploadText, uploadImage, ApiError, type AuthResult } from './src/api';

/* ============================ design tokens ============================ */
const C = {
  bg: '#f4f6fb', card: '#ffffff', ink: '#101627', soft: '#5b6472', line: '#e7ebf2',
  brand: '#2563EB', brandDark: '#1E3A8A', brandSoft: '#e8f0fe',
  good: '#0F9D58', goodBg: '#e6f6ec', warn: '#B7791F', warnBg: '#fdf3dc',
  crit: '#D03B3B', critBg: '#fdecec', violet: '#6D28D9', violetBg: '#efe9fd', surf2: '#eef1f6',
};
const fmt = (x?: string) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const initialsOf = (n = '?') => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/* ============================ root ============================ */
type Tab = 'home' | 'vault' | 'ask' | 'reminders' | 'profile';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<null | 'personalise'>(null);
  const [capture, setCapture] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      await loadTokens();
      if (hasToken()) { try { setMe(await api.me()); } catch { await setTokens(null, null); } }
      setBooting(false);
    })();
  }, []);

  const refreshMe = async () => { try { setMe(await api.me()); } catch { /* ignore */ } };
  const bump = () => setReloadKey((k) => k + 1);

  if (booting) return (
    <SafeAreaView style={[st.safe, { justifyContent: 'center', alignItems: 'center' }]}><StatusBar style="dark" />
      <View style={st.logoLg}><Text style={st.logoLgTxt}>V</Text></View>
      <Text style={{ marginTop: 16, color: C.soft, fontWeight: '600' }}>Vaulmo</Text>
    </SafeAreaView>
  );

  if (!me) return <Auth onAuthed={setMe} />;

  const screens: Record<Tab, JSX.Element> = {
    home: <Home key={`h${reloadKey}`} me={me} goTab={setTab} openPersonalise={() => setOverlay('personalise')} openCapture={() => setCapture(true)} />,
    vault: <Vault key={`v${reloadKey}`} goTab={setTab} openPersonalise={() => setOverlay('personalise')} openCapture={() => setCapture(true)} onChange={bump} />,
    ask: <Ask />,
    reminders: <Reminders key={`r${reloadKey}`} onChange={bump} />,
    profile: <Profile me={me} refreshMe={refreshMe} goTab={setTab} onSignOut={async () => { await setTokens(null, null); setMe(null); setTab('home'); }} />,
  };

  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      {screens[tab]}

      {/* bottom tab bar with centre capture button */}
      <View style={st.tabbar}>
        {TABS.map((t) => t.id === 'capture'
          ? <TouchableOpacity key="capture" style={st.fab} onPress={() => setCapture(true)} activeOpacity={0.85}><Text style={st.fabPlus}>＋</Text></TouchableOpacity>
          : <TouchableOpacity key={t.id} style={st.tab} onPress={() => setTab(t.id as Tab)} activeOpacity={0.7}>
              <Text style={[st.tabIc, tab === t.id && { opacity: 1 }]}>{t.ic}</Text>
              <Text style={[st.tabLabel, tab === t.id && { color: C.brand }]}>{t.label}</Text>
            </TouchableOpacity>)}
      </View>

      {/* capture flow */}
      <Modal visible={capture} animationType="slide" onRequestClose={() => setCapture(false)}>
        <Capture onClose={() => setCapture(false)} onStored={() => { setCapture(false); setTab('vault'); bump(); }} />
      </Modal>

      {/* personalise overlay */}
      <Modal visible={overlay === 'personalise'} animationType="slide" onRequestClose={() => setOverlay(null)}>
        <Personalise onClose={() => setOverlay(null)} onSaved={() => { setOverlay(null); bump(); }} />
      </Modal>
    </SafeAreaView>
  );
}

const TABS = [
  { id: 'home', ic: '🏠', label: 'Home' },
  { id: 'vault', ic: '🗄️', label: 'Vault' },
  { id: 'capture', ic: '＋', label: '' },
  { id: 'reminders', ic: '🔔', label: 'Reminders' },
  { id: 'profile', ic: '👤', label: 'You' },
] as const;

/* ============================ auth ============================ */
function Auth({ onAuthed }: { onAuthed: (me: any) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'mfa'>('login');
  const [f, setF] = useState({ fullName: '', email: '', password: '', code: '' });
  const [challenge, setChallenge] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function afterAuth(r: AuthResult) {
    if (r.mfaRequired && r.challengeToken) { setChallenge(r.challengeToken); setMode('mfa'); return; }
    if (r.accessToken && r.refreshToken) { await setTokens(r.accessToken, r.refreshToken); onAuthed(await api.me()); }
  }
  const run = (fn: () => Promise<void>) => async () => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong'); } finally { setBusy(false); } };

  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={st.authWrap} keyboardShouldPersistTaps="handled">
          <View style={st.logoLg}><Text style={st.logoLgTxt}>V</Text></View>
          <Text style={st.authTitle}>{mode === 'register' ? 'Create your household' : mode === 'mfa' ? 'Two-factor code' : 'Welcome to Vaulmo'}</Text>
          <Text style={st.authSub}>{mode === 'register' ? 'Your secure home for life’s important documents.' : mode === 'mfa' ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to your family vault.'}</Text>
          {!!err && <View style={st.errBox}><Text style={st.errTxt}>{err}</Text></View>}

          {mode === 'register' && <Field label="Full name" value={f.fullName} onChangeText={(v: string) => set('fullName', v)} placeholder="Alex Morgan" />}
          {mode !== 'mfa' && <>
            <Field label="Email" value={f.email} onChangeText={(v: string) => set('email', v)} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
            <Field label="Password" value={f.password} onChangeText={(v: string) => set('password', v)} secureTextEntry placeholder="••••••••" />
          </>}
          {mode === 'mfa' && <Field label="Authenticator code" value={f.code} onChangeText={(v: string) => set('code', v)} keyboardType="number-pad" placeholder="123456" />}

          {mode === 'login' && <Btn label="Sign in" busy={busy} onPress={run(async () => afterAuth(await api.login({ email: f.email.trim(), password: f.password })))} />}
          {mode === 'register' && <Btn label="Create account" busy={busy} onPress={run(async () => afterAuth(await api.register({ fullName: f.fullName.trim(), email: f.email.trim(), password: f.password })))} />}
          {mode === 'mfa' && <Btn label="Verify" busy={busy} onPress={run(async () => afterAuth(await api.loginMfa(f.code.trim(), challenge!)))} />}

          {mode !== 'mfa' && <TouchableOpacity style={{ marginTop: 18, alignItems: 'center' }} onPress={() => { setErr(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
            <Text style={st.link}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}</Text>
          </TouchableOpacity>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ============================ home ============================ */
function Home({ me, goTab, openPersonalise, openCapture }: any) {
  const [cl] = useAsync(() => api.checklist());
  const [brief] = useAsync(() => api.whatsImportant());
  const [rem] = useAsync(() => api.reminders());
  if (!cl) return <Loading />;
  const up = (rem?.live ?? []).slice().sort((a: any, b: any) => (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1);
  return (
    <ScrollView contentContainerStyle={st.pad} showsVerticalScrollIndicator={false}>
      <Header title={`Hi, ${(me.fullName || '').split(' ')[0] || 'there'}`} subtitle="Here’s what matters today" me={me} />

      {!cl.onboardingCompleted && (
        <TouchableOpacity style={st.promptCard} activeOpacity={0.85} onPress={openPersonalise}>
          <Text style={st.promptTitle}>Welcome to Vaulmo 👋</Text>
          <Text style={st.promptBody}>Take a minute to personalise your document checklist so it fits your household.</Text>
          <View style={st.promptBtn}><Text style={st.promptBtnTxt}>Get started →</Text></View>
        </TouchableOpacity>
      )}

      <View style={st.hero}>
        <Text style={st.heroLab}>YOUR VAULMO</Text>
        <Text style={st.heroBig}>{cl.completionScore}% complete</Text>
        <View style={st.progTrack}><View style={[st.progFill, { width: `${Math.max(4, cl.completionScore)}%` }]} /></View>
        <Text style={st.heroSub}>{cl.outstanding?.length ?? 0} recommended document{(cl.outstanding?.length ?? 0) === 1 ? '' : 's'} to add</Text>
      </View>

      <View style={st.row2}>
        <Stat v={rem?.live?.length ?? 0} l="Live reminders" tint={C.warnBg} />
        <Stat v={cl.confirmed ?? 0} l="Verified docs" tint={C.goodBg} />
      </View>

      <Card>
        <Text style={st.cardT}>What you need to know</Text>
        <Text style={st.muted}>{brief?.summary ?? 'You’re all set for now.'}</Text>
      </Card>

      <SectionTitle>Quick actions</SectionTitle>
      <Action ic="📸" bg={C.brandSoft} t="Scan a document" s="Snap a photo, we read the details" onPress={openCapture} />
      <Action ic="💬" bg={C.goodBg} t="Ask Vaulmo" s="“When does my passport expire?”" onPress={() => goTab('ask')} />
      <Action ic="🗄️" bg={C.violetBg} t="Open my vault" s="Everything you’ve stored" onPress={() => goTab('vault')} />

      {up.length > 0 && <>
        <SectionTitle>Coming up</SectionTitle>
        {up.slice(0, 5).map((r: any) => <Item key={r.id} icon="🔔" t={r.title} sub={fmt(r.dueDate)} right={<DuePill dueDate={r.dueDate} />} />)}
      </>}
    </ScrollView>
  );
}

/* ============================ vault ============================ */
const DECISION_OPTS: [string, string][] = [['store_now', 'Store now'], ['upload_later', 'Upload later'], ['remind_me', 'Remind me'], ['not_applicable', 'N/A']];
const DECISION_LABEL: Record<string, string> = { store_now: 'Storing now', upload_later: 'Upload later', remind_me: 'Reminder set', not_applicable: 'Not applicable', do_not_store: 'Won’t store' };

function Vault({ goTab, openPersonalise, openCapture, onChange }: any) {
  const [docs, reloadDocs] = useAsync(() => api.documents());
  const [cl, reloadCl] = useAsync(() => api.checklist());
  const [busyKey, setBusyKey] = useState('');
  if (!docs || !cl) return <Loading />;
  const missing = (cl.items ?? []).filter((i: any) => i.state === 'missing');

  async function decide(key: string, decision: string) {
    if (decision === 'store_now') { openCapture(); return; }
    setBusyKey(key + decision);
    try { await api.checklistDecision(key, decision); await reloadCl(); onChange?.(); }
    catch (e) { Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Try again'); }
    finally { setBusyKey(''); }
  }
  function remove(d: any) {
    Alert.alert('Delete document', `Remove “${d.title}” from your vault?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.deleteDocument(d.id); await reloadDocs(); await reloadCl(); onChange?.(); } catch { Alert.alert('Delete failed'); } } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={st.pad} showsVerticalScrollIndicator={false}>
      <Header title="My Vault" subtitle={`${cl.completionScore}% complete · ${(docs.documents ?? []).length} documents`} />

      {!cl.onboardingCompleted && (
        <TouchableOpacity style={st.promptCardSm} activeOpacity={0.85} onPress={openPersonalise}>
          <View style={{ flex: 1 }}>
            <Text style={st.promptTitleSm}>Make this checklist yours</Text>
            <Text style={st.promptBodySm}>Answer a few quick questions so we only recommend documents that apply to you.</Text>
          </View>
          <Text style={st.chev}>›</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={st.scanCta} activeOpacity={0.9} onPress={openCapture}>
        <Text style={st.scanCtaIc}>📸</Text>
        <View style={{ flex: 1 }}><Text style={st.scanCtaT}>Scan a document</Text><Text style={st.scanCtaS}>Take a photo or choose from your library</Text></View>
        <Text style={{ color: '#fff', fontSize: 22 }}>›</Text>
      </TouchableOpacity>

      <SectionTitle>Recommended documents</SectionTitle>
      {missing.length ? missing.map((it: any) => (
        <View key={it.key} style={st.recCard}>
          <View style={st.recTop}>
            <Text style={st.recIc}>{CAT_IC[it.category] ?? '📄'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.itemT}>{it.name}</Text>
              <Text style={st.itemS}>{it.category}{it.decision ? ` · ${DECISION_LABEL[it.decision] ?? it.decision}` : ' · not stored yet'}</Text>
            </View>
          </View>
          <View style={st.chipRow}>
            {DECISION_OPTS.map(([v, l]) => (
              <TouchableOpacity key={v} style={[st.chip, it.decision === v && st.chipOn]} disabled={!!busyKey} onPress={() => decide(it.key, v)}>
                <Text style={[st.chipTxt, it.decision === v && st.chipTxtOn]}>{busyKey === it.key + v ? '…' : l}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )) : <Card><Text style={st.muted}>Nothing outstanding — every recommended document is on file. 🎉</Text></Card>}

      <SectionTitle>Your documents</SectionTitle>
      {(docs.documents ?? []).length ? (docs.documents ?? []).map((d: any) => (
        <Item key={d.id} icon={CAT_IC[capCat(d.typeKey)] ?? '📄'} t={d.title}
          sub={`${d.typeKey ?? 'unclassified'} · ${d.status === 'CONFIRMED' ? 'Verified' : 'Pending'}`}
          badge={d.version > 1 ? `v${d.version}` : undefined}
          right={<TouchableOpacity onPress={() => remove(d)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={{ fontSize: 18 }}>🗑️</Text></TouchableOpacity>} />
      )) : <Card><Text style={st.muted}>No documents yet — scan your first one above.</Text></Card>}
    </ScrollView>
  );
}

/* ============================ capture flow ============================ */
const SAMPLE = 'UNITED KINGDOM\nPASSPORT\nPassport No: 546872331\nSurname: REID\nNationality: British\nDate of expiry: 22 Mar 2027';

function Capture({ onClose, onStored }: { onClose: () => void; onStored: () => void }) {
  const [step, setStep] = useState<'choose' | 'preview' | 'text' | 'review'>('choose');
  const [image, setImage] = useState<{ uri: string; contentType: string; filename: string } | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [doc, setDoc] = useState<any>(null);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function pick(from: 'camera' | 'library') {
    setErr('');
    try {
      const perm = from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr(`Please allow ${from === 'camera' ? 'camera' : 'photo'} access in Settings to continue.`); return; }
      const res = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, allowsEditing: true });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      // Downscale + compress before upload so large photos move quickly.
      const m = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: 1600 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
      const base = (a.fileName ?? 'scan').replace(/\.[^.]+$/, '');
      setImage({ uri: m.uri, contentType: 'image/jpeg', filename: `${base}.jpg` });
      setStep('preview');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not open the image.'); }
  }

  async function scanImage() {
    if (!image) return;
    setBusy('Uploading…');
    setErr('');
    try {
      const blob = await (await fetch(image.uri)).blob();
      const init = await api.createDocument({ filename: image.filename, contentType: image.contentType, sizeBytes: blob.size, title: 'Scanned document' });
      await uploadImage(init.uploadUrl, image.uri, image.contentType);
      setBusy('Reading…');
      const r = await api.processDocument(init.documentId);
      finishProcess(init.documentId, r);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Scan failed. Try a clearer photo.'); setBusy(''); }
  }
  async function scanText() {
    setBusy('Reading…');
    setErr('');
    try {
      const bytes = new Blob([text]).size;
      const init = await api.createDocument({ filename: 'doc.txt', contentType: 'text/plain', sizeBytes: bytes, title: 'Document' });
      await uploadText(init.uploadUrl, text);
      const r = await api.processDocument(init.documentId);
      finishProcess(init.documentId, r);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not read the text.'); setBusy(''); }
  }
  function finishProcess(id: string, r: any) {
    const m: Record<string, string> = {};
    (r.extracted ?? []).forEach((fld: any) => { if (fld.value) m[fld.key] = fld.value; });
    setDoc({ id, extracted: r.extracted ?? [], classification: r.classification, engine: r.engine });
    setMeta(m);
    setBusy('');
    setStep('review');
  }
  async function confirm() {
    setBusy('Storing…');
    try { await api.confirmDocument(doc.id, meta); onStored(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not store.'); setBusy(''); }
  }

  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      <View style={st.modalTop}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={st.modalClose}>✕</Text></TouchableOpacity>
        <Text style={st.modalTitle}>{step === 'review' ? 'Check the details' : 'Add a document'}</Text>
        <View style={{ width: 22 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={st.pad} keyboardShouldPersistTaps="handled">
          {!!err && <View style={st.errBox}><Text style={st.errTxt}>{err}</Text></View>}

          {step === 'choose' && <>
            <Text style={st.muted}>Snap a photo of a document and Vaulmo will read the details for you.</Text>
            <TouchableOpacity style={st.bigChoice} activeOpacity={0.9} onPress={() => pick('camera')}>
              <Text style={st.bigChoiceIc}>📷</Text><Text style={st.bigChoiceT}>Take a photo</Text><Text style={st.bigChoiceS}>Use your camera to scan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.bigChoice} activeOpacity={0.9} onPress={() => pick('library')}>
              <Text style={st.bigChoiceIc}>🖼️</Text><Text style={st.bigChoiceT}>Choose from library</Text><Text style={st.bigChoiceS}>Pick an existing photo or scan</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={() => setStep('text')}><Text style={st.link}>Type or paste text instead</Text></TouchableOpacity>
          </>}

          {step === 'preview' && image && <>
            <Image source={{ uri: image.uri }} style={st.preview} resizeMode="contain" />
            <Btn label="Scan this document" busy={!!busy} busyLabel={busy} onPress={scanImage} />
            <Btn label="Retake" secondary onPress={() => { setImage(null); setStep('choose'); }} />
          </>}

          {step === 'text' && <>
            <Field label="Paste document text" value={text} onChangeText={setText} multiline />
            <Btn label="Scan & extract" busy={!!busy} busyLabel={busy} onPress={scanText} />
            <Btn label="Back" secondary onPress={() => setStep('choose')} />
          </>}

          {step === 'review' && doc && <>
            <View style={st.okBox}><Text style={st.okTxt}>Classified as {doc.classification?.typeKey ?? 'document'} ({Math.round((doc.classification?.confidence ?? 0) * 100)}% · {doc.engine})</Text></View>
            <Text style={st.muted}>Check what we read, edit anything that’s off, then store it.</Text>
            {doc.extracted.map((fld: any) => (
              <Field key={fld.key} label={fld.label} value={meta[fld.key] ?? ''} onChangeText={(v: string) => setMeta((s) => ({ ...s, [fld.key]: v }))} />
            ))}
            <Btn label="Confirm & store" busy={!!busy} busyLabel={busy} onPress={confirm} />
            <Btn label="Start over" secondary onPress={() => { setDoc(null); setImage(null); setStep('choose'); }} />
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ============================ personalise ============================ */
function Personalise({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [data] = useAsync(() => api.onboarding());
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !seeded) { setAnswers(data.answers ?? {}); setSeeded(true); } }, [data, seeded]);
  const questions = data?.questions ?? [];
  const answered = questions.filter((q: any) => answers[q.key] !== undefined && answers[q.key] !== '').length;

  async function save() {
    setBusy(true);
    try { await api.saveOnboarding(answers); onSaved(); }
    catch (e) { Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      <View style={st.modalTop}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={st.modalClose}>✕</Text></TouchableOpacity>
        <Text style={st.modalTitle}>Personalise</Text><View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={st.pad}>
        {!data ? <Loading /> : <>
          {data.completed && <View style={st.okBox}><Text style={st.okTxt}>✅ You’ve personalised Vaulmo. Update your answers any time.</Text></View>}
          <Text style={st.muted}>Your answers decide which documents Vaulmo recommends — for example, we’ll only ask for an MOT if you have a vehicle.</Text>
          {questions.map((q: any) => (
            <View key={q.key} style={st.qBlock}>
              <Text style={st.qLabel}>{q.label}</Text>
              {!!q.help && <Text style={st.qHelp}>{q.help}</Text>}
              <View style={st.chipRow}>
                {(q.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : (q.options ?? []).map((o: any) => [o.value, o.label])).map(([v, l]: any) => {
                  const on = q.type === 'boolean' ? answers[q.key] === (v === 'true') : answers[q.key] === v;
                  return (
                    <TouchableOpacity key={v} style={[st.chip, on && st.chipOn]} onPress={() => setAnswers((s) => ({ ...s, [q.key]: q.type === 'boolean' ? v === 'true' : v }))}>
                      <Text style={[st.chipTxt, on && st.chipTxtOn]}>{l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
          <Btn label={data.completed ? 'Update my answers' : 'Save & tailor my checklist'} busy={busy} disabled={answered < questions.length} onPress={save} />
          <Text style={[st.muted, { textAlign: 'center', marginTop: 8 }]}>{answered}/{questions.length} answered</Text>
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ============================ ask ============================ */
function Ask() {
  const [chat, setChat] = useState<any[]>([{ role: 'ai', text: 'Hi! Ask me anything about your vault — “when does my passport expire?”' }]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  async function ask(question: string) {
    if (!question.trim()) return;
    setChat((c) => [...c, { role: 'me', text: question }]); setQ(''); setBusy(true);
    try { const r = await api.ask(question); setChat((c) => [...c, { role: 'ai', text: r.answer, sources: r.sources }]); }
    catch { setChat((c) => [...c, { role: 'ai', text: 'Sorry — something went wrong.' }]); }
    finally { setBusy(false); }
  }
  const chips = ['When does my passport expire?', 'What’s renewing soon?', 'Any warranties active?'];
  return (
    <View style={{ flex: 1 }}>
      <View style={st.pageHead}><Text style={st.pageTitle}>Ask Vaulmo</Text><Text style={st.pageSub}>Answers from your own vault</Text></View>
      <ScrollView contentContainerStyle={[st.pad, { paddingTop: 6 }]}>
        {chat.map((m, i) => (
          <View key={i} style={[st.msgRow, m.role === 'me' && { justifyContent: 'flex-end' }]}>
            {m.role === 'ai' && <View style={st.aiDot}><Text style={{ color: '#fff', fontWeight: '800' }}>V</Text></View>}
            <View style={[st.bubble, m.role === 'me' ? st.bubbleMe : st.bubbleAi]}>
              <Text style={m.role === 'me' ? { color: '#fff' } : { color: C.ink }}>{m.text}</Text>
              {!!m.sources?.length && <Text style={st.src}>Sources: {m.sources.map((x: any) => x.ref).join(', ')}</Text>}
            </View>
          </View>
        ))}
        {busy && <View style={st.msgRow}><View style={st.aiDot}><Text style={{ color: '#fff', fontWeight: '800' }}>V</Text></View><View style={[st.bubble, st.bubbleAi]}><ActivityIndicator /></View></View>}
        <View style={st.chipsWrap}>{chips.map((c) => <TouchableOpacity key={c} style={st.askChip} onPress={() => ask(c)}><Text style={st.askChipTxt}>{c}</Text></TouchableOpacity>)}</View>
      </ScrollView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={st.composer}>
          <TextInput style={st.composerInput} value={q} onChangeText={setQ} placeholder="Ask a question…" placeholderTextColor={C.soft} onSubmitEditing={() => ask(q)} returnKeyType="send" />
          <TouchableOpacity style={st.sendBtn} onPress={() => ask(q)}><Text style={{ color: '#fff', fontWeight: '700' }}>Ask</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ============================ reminders ============================ */
function Reminders({ onChange }: any) {
  const [data, reload] = useAsync(() => api.reminderCentre());
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const groups: [string, any[]][] = [
    ['Overdue', data.overdue ?? []],
    ['Upcoming', data.upcoming ?? []],
    ['Snoozed', data.snoozed ?? []],
    ['Completed', data.completed ?? []],
  ];
  async function add() {
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(due)) { Alert.alert('Add a title and a date', 'Use the format YYYY-MM-DD, e.g. 2026-12-01.'); return; }
    setBusy(true);
    try { await api.createReminder({ title: title.trim(), dueDate: due }); setTitle(''); setDue(''); setAdding(false); await reload(); onChange?.(); }
    catch (e) { Alert.alert('Could not add', e instanceof ApiError ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function complete(id: string) { try { await api.completeReminder(id); await reload(); onChange?.(); } catch { Alert.alert('Try again'); } }
  async function snooze(id: string) { try { await api.snoozeReminder(id, 7); await reload(); onChange?.(); } catch { Alert.alert('Try again'); } }

  return (
    <ScrollView contentContainerStyle={st.pad} showsVerticalScrollIndicator={false}>
      <View style={st.spread}>
        <View><Text style={st.pageTitle}>Reminders</Text><Text style={st.pageSub}>What needs your attention</Text></View>
        <TouchableOpacity style={st.smBtn} onPress={() => setAdding((a) => !a)}><Text style={st.smBtnTxt}>{adding ? 'Close' : '+ Add'}</Text></TouchableOpacity>
      </View>

      {adding && <Card>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Renew car insurance" />
        <Field label="Due date (YYYY-MM-DD)" value={due} onChangeText={setDue} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" />
        <Btn label="Add reminder" busy={busy} onPress={add} />
      </Card>}

      {groups.every(([, list]) => list.length === 0) && <Card><Text style={st.muted}>Nothing scheduled yet. Add a reminder or store documents to get automatic ones.</Text></Card>}
      {groups.map(([name, list]) => list.length > 0 && (
        <View key={name}>
          <SectionTitle>{name}</SectionTitle>
          {list.map((r: any) => (
            <View key={r.id} style={st.remCard}>
              <View style={{ flex: 1 }}>
                <Text style={st.itemT}>{r.title}</Text>
                <Text style={st.itemS}>{fmt(r.dueDate)}{r.recurrence ? ` · repeats ${r.recurrence}` : ''}</Text>
              </View>
              {name !== 'Completed' ? <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity style={st.remAct} onPress={() => snooze(r.id)}><Text style={st.remActTxt}>Snooze</Text></TouchableOpacity>
                <TouchableOpacity style={[st.remAct, st.remActDone]} onPress={() => complete(r.id)}><Text style={[st.remActTxt, { color: '#fff' }]}>Done</Text></TouchableOpacity>
              </View> : <Text style={{ fontSize: 18 }}>✅</Text>}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/* ============================ profile ============================ */
const TIMEZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney', 'UTC'];
const COUNTRIES: [string, string][] = [['GB', 'United Kingdom'], ['US', 'United States'], ['IE', 'Ireland'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['IN', 'India'], ['AE', 'UAE']];

function Profile({ me, refreshMe, onSignOut }: any) {
  const [nok] = useAsync(() => api.nok());
  const [ent] = useAsync(() => api.entitlements().catch(() => ({ planKey: me.tenant?.plan ?? 'starter' })));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.fullName ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const [tz, setTz] = useState(me.timezone ?? '');
  const [country, setCountry] = useState(me.tenant?.country ?? '');
  const [busy, setBusy] = useState(false);
  const isSuper = me?.roles?.includes('super_admin');

  async function save() {
    setBusy(true);
    try {
      const b: any = {};
      if (name.trim() && name.trim() !== me.fullName) b.fullName = name.trim();
      if ((phone ?? '') !== (me.phone ?? '')) b.phone = phone.trim() || null;
      if ((tz ?? '') !== (me.timezone ?? '')) b.timezone = tz || null;
      if (!isSuper && country && country !== (me.tenant?.country ?? '')) b.country = country;
      await api.updateProfile(b); await refreshMe(); setEditing(false);
    } catch (e) { Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={st.pad} showsVerticalScrollIndicator={false}>
      <View style={st.pageHead}><Text style={st.pageTitle}>You & Family</Text><Text style={st.pageSub}>Your account & details</Text></View>

      <View style={st.profileHead}>
        <View style={st.avatar}><Text style={st.avatarTxt}>{initialsOf(me.fullName)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.profileName}>{me.fullName}</Text>
          <Text style={st.muted}>{me.email}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
            <Text style={[st.tag, { backgroundColor: C.surf2 }]}>{isSuper ? 'Super Admin' : me.tenant?.name ?? 'Member'}</Text>
            <Text style={[st.tag, me.mfaEnabled ? { backgroundColor: C.goodBg, color: C.good } : { backgroundColor: C.warnBg, color: C.warn }]}>{me.mfaEnabled ? '2FA on' : '2FA off'}</Text>
          </View>
        </View>
      </View>

      {!editing ? <>
        <Card>
          <Row label="Full name" value={me.fullName} />
          <Row label="Phone" value={me.phone || 'Not set'} />
          <Row label="Timezone" value={me.timezone || 'Not set'} />
          {!isSuper && <Row label="Country" value={me.tenant?.country || 'Not set'} last />}
          <Btn label="Edit profile" secondary onPress={() => setEditing(true)} />
        </Card>
      </> : <Card>
        <Field label="Full name" value={name} onChangeText={setName} />
        <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+44 7700 900123" keyboardType="phone-pad" />
        <Picker label="Timezone" value={tz} options={[['', 'Not set'], ...TIMEZONES.map((z) => [z, z] as [string, string])]} onChange={setTz} />
        {!isSuper && <Picker label="Country" value={country} options={[['', 'Not set'], ...COUNTRIES]} onChange={setCountry} />}
        <Btn label="Save changes" busy={busy} onPress={save} />
        <Btn label="Cancel" secondary onPress={() => { setEditing(false); setName(me.fullName ?? ''); setPhone(me.phone ?? ''); setTz(me.timezone ?? ''); setCountry(me.tenant?.country ?? ''); }} />
      </Card>}

      <View style={st.planCard}>
        <Text style={st.planLab}>YOUR PLAN</Text>
        <Text style={st.planName}>{ent?.planKey ?? me.tenant?.plan ?? 'starter'}</Text>
        {me.tenant?.status && <Text style={{ color: '#fff', opacity: 0.85, fontSize: 12.5, marginTop: 2, textTransform: 'capitalize' }}>{me.tenant.status}</Text>}
      </View>

      {!isSuper && <>
        <SectionTitle>Next of kin</SectionTitle>
        {(nok?.nextOfKin ?? []).length ? (nok?.nextOfKin ?? []).map((n: any) => <Item key={n.id} icon="👤" t={n.name} sub={n.email} right={<Text style={st.tag}>{n.status}</Text>} />)
          : <Card><Text style={st.muted}>No next of kin nominated yet. You can add trusted people from the web app.</Text></Card>}
      </>}

      <View style={{ height: 8 }} />
      <Btn label="Sign out" secondary onPress={onSignOut} />
    </ScrollView>
  );
}

/* ============================ primitives ============================ */
function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const reload = () => fn().then(setData).catch(() => {});
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return [data, reload] as const;
}
const Loading = () => <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 }}><ActivityIndicator color={C.brand} /></View>;
const CAT_IC: Record<string, string> = { Identity: '🪪', Insurance: '🛡️', Vehicle: '🚗', Property: '🏠', Warranties: '⭐', Legal: '⚖️', Travel: '✈️', Health: '❤️', Finance: '💳' };
const capCat = (t?: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

function Header({ title, subtitle, me }: any) {
  return (
    <View style={st.headerRow}>
      <View style={{ flex: 1 }}><Text style={st.pageTitle}>{title}</Text><Text style={st.pageSub}>{subtitle}</Text></View>
      {me && <View style={st.avatarSm}><Text style={st.avatarSmTxt}>{initialsOf(me.fullName)}</Text></View>}
    </View>
  );
}
const SectionTitle = ({ children }: any) => <Text style={st.section}>{children}</Text>;
const Card = ({ children }: any) => <View style={st.card}>{children}</View>;

function Btn({ label, onPress, secondary, busy, busyLabel, disabled }: any) {
  const off = busy || disabled;
  return (
    <TouchableOpacity style={[st.btn, secondary && st.btnSec, off && { opacity: 0.6 }]} onPress={onPress} disabled={off} activeOpacity={0.85}>
      {busy ? <ActivityIndicator color={secondary ? C.brand : '#fff'} /> : <Text style={[st.btnTxt, secondary && { color: C.brand }]}>{busyLabel && busy ? busyLabel : label}</Text>}
    </TouchableOpacity>
  );
}
function Field({ label, multiline, ...rest }: any) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TextInput style={[st.input, multiline && { height: 120, textAlignVertical: 'top' }]} placeholderTextColor={C.soft} multiline={multiline} {...rest} />
    </View>
  );
}
function Picker({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      <View style={st.pickerWrap}>
        {options.map(([v, l]) => (
          <TouchableOpacity key={v || 'none'} style={[st.pickerChip, value === v && st.chipOn]} onPress={() => onChange(v)}>
            <Text style={[st.chipTxt, value === v && st.chipTxtOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
const Stat = ({ v, l, tint }: any) => <View style={[st.stat]}><View style={[st.statDot, { backgroundColor: tint }]} /><Text style={st.statV}>{v}</Text><Text style={st.statL}>{l}</Text></View>;
function Item({ icon, t, sub, right, badge }: any) {
  return (
    <View style={st.item}>
      <View style={st.itemIc}><Text style={{ fontSize: 18 }}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={st.itemT}>{t}</Text>
          {badge && <Text style={st.badge}>{badge}</Text>}
        </View>
        <Text style={st.itemS}>{sub}</Text>
      </View>
      {right}
    </View>
  );
}
function Action({ ic, bg, t, s, onPress }: any) {
  return (
    <TouchableOpacity style={st.item} activeOpacity={0.8} onPress={onPress}>
      <View style={[st.itemIc, { backgroundColor: bg }]}><Text style={{ fontSize: 18 }}>{ic}</Text></View>
      <View style={{ flex: 1 }}><Text style={st.itemT}>{t}</Text><Text style={st.itemS}>{s}</Text></View>
      <Text style={st.chev}>›</Text>
    </TouchableOpacity>
  );
}
function Row({ label, value, last }: any) {
  return <View style={[st.detailRow, last && { borderBottomWidth: 0 }]}><Text style={st.muted}>{label}</Text><Text style={st.detailVal}>{value}</Text></View>;
}
function DuePill({ dueDate }: { dueDate?: string }) {
  if (!dueDate) return <Text style={[st.tag, { backgroundColor: C.surf2 }]}>on file</Text>;
  const d = Math.round((+new Date(dueDate) - Date.now()) / 86400000);
  const style = d < 0 ? { backgroundColor: C.critBg, color: C.crit } : d <= 30 ? { backgroundColor: C.warnBg, color: C.warn } : { backgroundColor: C.goodBg, color: C.good };
  return <Text style={[st.tag, style]}>{d < 0 ? `${-d}d overdue` : `in ${d}d`}</Text>;
}

/* ============================ styles ============================ */
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 18, paddingBottom: 120 },

  // logo / splash
  logoLg: { width: 60, height: 60, borderRadius: 18, backgroundColor: C.brandDark, alignItems: 'center', justifyContent: 'center' },
  logoLgTxt: { color: '#fff', fontWeight: '800', fontSize: 26 },

  // auth
  authWrap: { padding: 26, paddingTop: 64, flexGrow: 1 },
  authTitle: { fontSize: 24, fontWeight: '800', color: C.ink, marginTop: 20 },
  authSub: { fontSize: 14, color: C.soft, marginTop: 6, marginBottom: 8 },
  link: { color: C.brand, fontWeight: '700', fontSize: 14 },
  errBox: { backgroundColor: C.critBg, borderRadius: 10, padding: 11, marginTop: 12 },
  errTxt: { color: C.crit, fontSize: 13.5, fontWeight: '600' },
  okBox: { backgroundColor: C.goodBg, borderRadius: 10, padding: 11, marginBottom: 10 },
  okTxt: { color: C.good, fontSize: 13.5, fontWeight: '600' },

  // headers
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  pageHead: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 4 },
  pageTitle: { fontSize: 24, fontWeight: '800', color: C.ink },
  pageSub: { fontSize: 13.5, color: C.soft, marginTop: 2 },
  avatarSm: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  avatarSmTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // hero
  hero: { backgroundColor: C.brand, borderRadius: 22, padding: 20, marginBottom: 14 },
  heroLab: { color: '#fff', opacity: 0.85, fontSize: 11.5, fontWeight: '800', letterSpacing: 1 },
  heroBig: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 6 },
  progTrack: { height: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.28)', marginTop: 12, overflow: 'hidden' },
  progFill: { height: 8, borderRadius: 6, backgroundColor: '#fff' },
  heroSub: { color: '#fff', opacity: 0.92, fontSize: 13, marginTop: 10 },

  // prompt cards
  promptCard: { backgroundColor: C.brandSoft, borderRadius: 18, padding: 16, marginBottom: 14 },
  promptTitle: { fontWeight: '800', fontSize: 15.5, color: C.ink },
  promptBody: { color: C.soft, fontSize: 13.5, marginTop: 4 },
  promptBtn: { alignSelf: 'flex-start', backgroundColor: C.brand, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginTop: 12 },
  promptBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  promptCardSm: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.brandSoft, borderRadius: 16, padding: 14, marginBottom: 12 },
  promptTitleSm: { fontWeight: '700', fontSize: 14.5, color: C.ink },
  promptBodySm: { color: C.soft, fontSize: 12.5, marginTop: 2 },

  // stats
  row2: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 15 },
  statDot: { width: 26, height: 26, borderRadius: 9, marginBottom: 8 },
  statV: { fontSize: 24, fontWeight: '800', color: C.ink },
  statL: { fontSize: 12.5, color: C.soft, fontWeight: '600', marginTop: 1 },

  // cards / sections
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardT: { fontWeight: '800', marginBottom: 6, color: C.ink, fontSize: 15 },
  muted: { color: C.soft, fontSize: 13.5, lineHeight: 19 },
  section: { fontSize: 15.5, fontWeight: '800', color: C.ink, marginTop: 18, marginBottom: 10 },

  // items
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 12, marginBottom: 10 },
  itemIc: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.surf2, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  itemT: { fontWeight: '700', fontSize: 14.5, color: C.ink },
  itemS: { fontSize: 12.5, color: C.soft, marginTop: 1 },
  chev: { color: C.soft, fontSize: 22, marginLeft: 6 },
  badge: { fontSize: 11, fontWeight: '800', color: C.brand, backgroundColor: C.brandSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  tag: { fontSize: 11.5, fontWeight: '700', color: C.soft, backgroundColor: C.surf2, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, overflow: 'hidden' },

  // scan CTA
  scanCta: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.brandDark, borderRadius: 18, padding: 16, marginBottom: 4 },
  scanCtaIc: { fontSize: 26, marginRight: 12 },
  scanCtaT: { color: '#fff', fontWeight: '800', fontSize: 15.5 },
  scanCtaS: { color: '#fff', opacity: 0.85, fontSize: 12.5, marginTop: 2 },

  // recommended checklist
  recCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10 },
  recTop: { flexDirection: 'row', alignItems: 'center' },
  recIc: { fontSize: 20, width: 34 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 13, backgroundColor: C.card },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipTxt: { fontSize: 13, fontWeight: '700', color: C.soft },
  chipTxtOn: { color: '#fff' },

  // buttons / inputs
  btn: { backgroundColor: C.brand, borderRadius: 13, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  btnSec: { backgroundColor: C.surf2 },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: C.soft, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 13, fontSize: 15, backgroundColor: C.card, color: C.ink },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickerChip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: C.card },

  // capture
  modalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.card },
  modalTitle: { fontSize: 16, fontWeight: '800', color: C.ink },
  modalClose: { fontSize: 20, color: C.soft, fontWeight: '700' },
  bigChoice: { backgroundColor: C.card, borderRadius: 18, padding: 22, alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: C.line },
  bigChoiceIc: { fontSize: 34 },
  bigChoiceT: { fontWeight: '800', fontSize: 16, color: C.ink, marginTop: 8 },
  bigChoiceS: { color: C.soft, fontSize: 13, marginTop: 2 },
  preview: { width: '100%', height: 320, borderRadius: 16, backgroundColor: '#000', marginBottom: 6 },

  // ask
  msgRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end' },
  aiDot: { width: 30, height: 30, borderRadius: 10, backgroundColor: C.brandDark, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  bubble: { padding: 12, borderRadius: 16, maxWidth: '80%' },
  bubbleAi: { backgroundColor: C.card, borderTopLeftRadius: 4 },
  bubbleMe: { backgroundColor: C.brand, borderTopRightRadius: 4 },
  src: { fontSize: 11.5, color: C.soft, marginTop: 6 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  askChip: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  askChipTxt: { color: C.brand, fontWeight: '600', fontSize: 12.5 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 96, backgroundColor: C.bg, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line },
  composerInput: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: C.card, fontSize: 15, color: C.ink },
  sendBtn: { backgroundColor: C.brand, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11 },

  // reminders
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  smBtn: { backgroundColor: C.brand, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 14 },
  smBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  remCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 13, marginBottom: 10 },
  remAct: { borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: C.surf2 },
  remActDone: { backgroundColor: C.good },
  remActTxt: { fontSize: 12.5, fontWeight: '700', color: C.soft },

  // personalise
  qBlock: { backgroundColor: C.card, borderRadius: 16, padding: 15, marginTop: 12 },
  qLabel: { fontWeight: '700', fontSize: 14.5, color: C.ink },
  qHelp: { color: C.soft, fontSize: 12.5, marginTop: 3 },

  // profile
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  avatar: { width: 62, height: 62, borderRadius: 18, backgroundColor: C.brandDark, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 22 },
  profileName: { fontSize: 18, fontWeight: '800', color: C.ink },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  detailVal: { fontWeight: '700', color: C.ink, fontSize: 14 },
  planCard: { backgroundColor: C.violet, borderRadius: 18, padding: 18, marginTop: 12 },
  planLab: { color: '#fff', opacity: 0.8, fontSize: 11.5, fontWeight: '800', letterSpacing: 1 },
  planName: { color: '#fff', fontSize: 20, fontWeight: '800', textTransform: 'capitalize', marginTop: 4 },

  // tab bar
  tabbar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 86, flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, paddingBottom: 8 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  tabIc: { fontSize: 21, opacity: 0.55 },
  tabLabel: { fontSize: 10.5, fontWeight: '700', color: C.soft, marginTop: 3 },
  fab: { width: 56, height: 56, borderRadius: 18, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: -16, marginHorizontal: 4, shadowColor: C.brand, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  fabPlus: { color: '#fff', fontSize: 30, marginTop: -2 },
});
