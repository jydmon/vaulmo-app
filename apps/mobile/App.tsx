import { useEffect, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Image, Modal, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system';
import { api, setTokens, loadTokens, hasToken, uploadText, uploadImage, fileSize, processPassport, ApiError, getFlag, setFlag, type AuthResult } from './src/api';
import { isDrivingEnabled, enableDrivingAlerts, disableDrivingAlerts, refreshDrivingData, money, openParkingSearch, nearbyParking, currentLatLng } from './src/driving';
import { getCapability, isBiometricEnabled, setBiometricEnabled, shouldLock, authenticate, type BiometricCapability } from './src/biometric';
import { registerForPush } from './src/push';

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
  const [sub, setSub] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const [show2fa, setShow2fa] = useState(false);
  const [locked, setLocked] = useState(false); // biometric app-lock gate on launch
  useEffect(() => {
    if (me && !((me.roles ?? []).includes('super_admin')) && me.onboarding?.complete && !me.onboarding?.tourSeen) setShowTour(true);
    if (me && !((me.roles ?? []).includes('super_admin')) && me.onboarding?.complete) registerForPush();
  }, [me]);
  // Optional 2FA popup — regular users only, shown after the tour, remembered on this device.
  useEffect(() => {
    (async () => {
      if (me && !((me.roles ?? []).includes('super_admin')) && me.onboarding?.complete && me.onboarding?.tourSeen && !me.mfaEnabled) {
        if (!(await getFlag('twofa'))) setShow2fa(true);
      }
    })();
  }, [me]);

  // Restore the stored session once biometric (if enabled) has been satisfied.
  const restoreSession = async () => { try { setMe(await api.me()); setLocked(false); } catch { await setTokens(null, null); setLocked(false); setMe(null); } };

  useEffect(() => {
    (async () => {
      await loadTokens();
      if (hasToken()) {
        if (await shouldLock()) setLocked(true); // hold the session behind the lock screen
        else { try { setMe(await api.me()); } catch { await setTokens(null, null); } }
      }
      setBooting(false);
    })();
  }, []);

  const refreshMe = async () => { try { setMe(await api.me()); } catch { /* ignore */ } };
  const bump = () => setReloadKey((k) => k + 1);

  if (booting) return (
    <SafeAreaView style={[st.safe, { justifyContent: 'center', alignItems: 'center' }]}><StatusBar style="dark" />
      <Image source={require('./assets/icon.png')} style={st.logoLg} resizeMode="cover" />
      <Text style={{ marginTop: 16, color: C.soft, fontWeight: '600' }}>Vaulmo</Text>
    </SafeAreaView>
  );

  if (locked) return <LockScreen onUnlock={restoreSession} onUsePassword={async () => { await setTokens(null, null); setLocked(false); setMe(null); }} />;

  if (!me) return <Auth onAuthed={setMe} />;

  const isSuper = (me.roles ?? []).includes('super_admin');
  if (!isSuper && me.onboarding && !me.onboarding.complete) {
    return <OnboardingGate me={me} refreshMe={refreshMe} onSignOut={async () => { await setTokens(null, null); setMe(null); }} />;
  }

  const screens: Record<Tab, JSX.Element> = {
    home: <Home key={`h${reloadKey}`} me={me} goTab={setTab} openPersonalise={() => setOverlay('personalise')} openCapture={() => setCapture(true)} />,
    vault: <Vault key={`v${reloadKey}`} goTab={setTab} openPersonalise={() => setOverlay('personalise')} openCapture={() => setCapture(true)} onChange={bump} />,
    ask: <Ask />,
    reminders: <Reminders key={`r${reloadKey}`} onChange={bump} />,
    profile: <Profile me={me} refreshMe={refreshMe} goTab={setTab} openSub={setSub} onSignOut={async () => { await setTokens(null, null); setMe(null); setTab('home'); }} />,
  };

  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      {screens[tab]}

      {/* bottom tab bar with centre capture button */}
      <View style={st.tabbar}>
        {TABS.map((t) => t.id === 'capture'
          ? <TouchableOpacity key="capture" style={st.fab} onPress={() => setCapture(true)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Add a document"><Text style={st.fabPlus}>＋</Text></TouchableOpacity>
          : <TouchableOpacity key={t.id} style={st.tab} onPress={() => setTab(t.id as Tab)} activeOpacity={0.7} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: tab === t.id }}>
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

      {/* welcome tour (post-onboarding) */}
      <Modal visible={showTour} transparent animationType="fade" onRequestClose={() => setShowTour(false)}>
        <WelcomeTour me={me} goSettings={() => { setShowTour(false); api.tourSeen().catch(() => {}); setTab('profile'); setSub('settings'); }} onClose={async () => { setShowTour(false); try { await api.tourSeen(); } catch {} refreshMe(); }} />
      </Modal>

      {/* optional two-factor prompt (skippable; can enable later from You → Settings) */}
      <Modal visible={show2fa} transparent animationType="fade" onRequestClose={() => setShow2fa(false)}>
        <TwoFactorPrompt
          onSetup={async () => { await setFlag('twofa', 'seen'); setShow2fa(false); setTab('profile'); setSub('settings'); }}
          onNotNow={async () => { await setFlag('twofa', 'seen'); setShow2fa(false); }}
        />
      </Modal>

      {/* secondary feature screens (pushed from the You tab) */}
      <Modal visible={!!sub} animationType="slide" onRequestClose={() => setSub(null)}>
        {sub && <SubScreen title={SUB_TITLES[sub] ?? ''} onClose={() => setSub(null)}>
          {sub === 'assets' && <Assets />}
          {sub === 'renewals' && <Renewals />}
          {sub === 'passwords' && <Passwords />}
          {sub === 'passport' && <PassportPhoto />}
          {sub === 'trips' && <Trips />}
          {sub === 'purchases' && <Purchases />}
          {sub === 'subs' && <Subs />}
          {sub === 'connected' && <Connected />}
          {sub === 'family' && <Family me={me} />}
          {sub === 'emergency' && <Emergency />}
          {sub === 'billing' && <Billing me={me} />}
          {sub === 'support' && <Support />}
          {sub === 'help' && <HelpCentre />}
          {sub === 'faq' && <FaqScreen />}
          {sub === 'privacy' && <PrivacySecurity />}
          {sub === 'settings' && <Settings me={me} refreshMe={refreshMe} />}
          {sub === 'driving' && <DrivingCharges />}
        </SubScreen>}
      </Modal>
    </SafeAreaView>
  );
}

const SUB_TITLES: Record<string, string> = {
  assets: 'Property & Vehicles', renewals: 'Renewals & Expiries', passwords: 'Password Vault', passport: 'Passport Photo', trips: 'Trips', purchases: 'Purchases & Warranties', subs: 'Subscriptions', connected: 'Connected Services',
  family: 'Family & Access', emergency: 'Emergency Access', billing: 'Plan & Billing', support: 'Support',
  help: 'Help Centre', faq: 'FAQ & Support', privacy: 'Privacy & Security', settings: 'Settings', driving: 'Driving charges',
};

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
  const [resetSent, setResetSent] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function afterAuth(r: AuthResult) {
    if (r.mfaRequired && r.challengeToken) { setChallenge(r.challengeToken); setMode('mfa'); return; }
    if (r.accessToken && r.refreshToken) { await setTokens(r.accessToken, r.refreshToken); const m = await api.me(); onAuthed(m); offerBiometricSetup(); }
  }
  const run = (fn: () => Promise<void>) => async () => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong'); } finally { setBusy(false); } };

  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={st.authWrap} keyboardShouldPersistTaps="handled">
          <Image source={require('./assets/icon.png')} style={st.logoLg} resizeMode="cover" />
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

          {/* Password reset. The link emailed to the user opens the web app, which is
              where the new password is actually chosen — the app only requests it. */}
          {mode === 'login' && !resetSent && <TouchableOpacity style={{ marginTop: 14, alignItems: 'center' }} disabled={busy}
            onPress={run(async () => {
              if (!f.email.trim()) { setErr('Enter your email address first, then tap Forgot password.'); return; }
              await api.requestPasswordReset(f.email.trim());
              setResetSent(true);
            })}>
            <Text style={st.link}>Forgot password?</Text>
          </TouchableOpacity>}
          {mode === 'login' && resetSent && <View style={{ marginTop: 14, paddingHorizontal: 8 }}>
            <Text style={[st.authSub, { textAlign: 'center' }]}>If an account exists for {f.email.trim()}, we’ve emailed a link to choose a new password. Open it on this device to finish. The link expires in 30 minutes.</Text>
            <TouchableOpacity style={{ marginTop: 10, alignItems: 'center' }} onPress={() => setResetSent(false)}>
              <Text style={st.link}>Send it again</Text>
            </TouchableOpacity>
          </View>}

          {mode !== 'mfa' && <TouchableOpacity style={{ marginTop: 18, alignItems: 'center' }} onPress={() => { setErr(''); setResetSent(false); setMode(mode === 'login' ? 'register' : 'login'); }}>
            <Text style={st.link}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}</Text>
          </TouchableOpacity>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ============================ biometric lock ============================ */
// One-time, non-blocking offer to turn on the biometric lock right after signing in.
// Only surfaces when the device can do biometrics and the user hasn't already chosen.
async function offerBiometricSetup() {
  try {
    if (await isBiometricEnabled()) return;
    const cap = await getCapability();
    if (!cap.available) return;
    Alert.alert(
      `Unlock with ${cap.label}?`,
      `Add ${cap.label} so only you can open Vaulmo on this device. You can change this anytime in Settings.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: `Use ${cap.label}`, onPress: async () => { const r = await authenticate(`Enable ${cap.label}`); if (r.success) await setBiometricEnabled(true); } },
      ],
    );
  } catch { /* never block sign-in on this */ }
}


function LockScreen({ onUnlock, onUsePassword }: { onUnlock: () => void | Promise<void>; onUsePassword: () => void | Promise<void> }) {
  const [cap, setCap] = useState<BiometricCapability | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const prompt = async () => {
    setBusy(true); setFailed(false);
    const r = await authenticate('Unlock Vaulmo');
    setBusy(false);
    if (r.success) await onUnlock(); else setFailed(true);
  };

  // Auto-present the biometric prompt as soon as the lock screen mounts.
  useEffect(() => { (async () => { const c = await getCapability(); setCap(c); await prompt(); })(); /* eslint-disable-next-line */ }, []);

  const label = cap?.label ?? 'Biometric unlock';
  const glyph = cap?.kind === 'face' ? '🙂' : cap?.kind === 'iris' ? '👁️' : '🔒';
  return (
    <SafeAreaView style={[st.safe, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}><StatusBar style="dark" />
      <Image source={require('./assets/icon.png')} style={st.logoLg} resizeMode="cover" />
      <Text style={[st.authTitle, { marginTop: 18 }]}>Vaulmo is locked</Text>
      <Text style={[st.authSub, { textAlign: 'center' }]}>Use {label} to unlock your vault.</Text>
      {failed && <View style={[st.errBox, { marginTop: 12 }]}><Text style={st.errTxt}>Unlock cancelled or not recognised. Try again.</Text></View>}
      <View style={{ width: '100%', maxWidth: 340, marginTop: 20 }}>
        <Btn label={busy ? 'Unlocking…' : `Unlock with ${label} ${glyph}`} busy={busy} onPress={prompt} />
        <TouchableOpacity style={{ marginTop: 18, alignItems: 'center' }} onPress={onUsePassword}>
          <Text style={st.link}>Sign in with password instead</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ============================ onboarding gate ============================ */
function OnboardingGate({ me, refreshMe, onSignOut }: any) {
  const ob = me.onboarding ?? {};
  const step = !ob.emailVerified ? 'verify' : !ob.termsAccepted ? 'terms' : 'plan';
  const stepNo = { verify: 1, terms: 2, plan: 3 }[step];
  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      <ScrollView contentContainerStyle={[st.pad, { paddingTop: 40 }]} keyboardShouldPersistTaps="handled">
        <Image source={require('./assets/icon.png')} style={st.logoLg} resizeMode="cover" />
        <Text style={[st.authTitle, { marginTop: 16 }]}>Let’s get you set up</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 12, marginBottom: 8 }}>
          {[1, 2, 3].map((n) => <View key={n} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: n <= stepNo ? C.brand : C.line }} />)}
        </View>
        {step === 'verify' && <OnbVerify me={me} refreshMe={refreshMe} />}
        {step === 'terms' && <OnbTerms refreshMe={refreshMe} />}
        {step === 'plan' && <OnbPlan refreshMe={refreshMe} />}
        <TouchableOpacity style={{ marginTop: 18, alignItems: 'center' }} onPress={onSignOut}><Text style={st.link}>Sign out</Text></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
function OnbVerify({ me, refreshMe }: any) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function send() {
    setBusy(true);
    try { const r = await api.requestVerification(); if (r.devToken) { await api.verifyEmail(r.devToken); await refreshMe(); } else setSent(true); }
    catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : ''); } finally { setBusy(false); }
  }
  return <Card>
    <Text style={st.cardT}>Verify your email</Text>
    <Text style={st.muted}>We need to confirm {me.email} before you start.</Text>
    <Btn label={sent ? 'Resend link' : 'Send verification link'} busy={busy} onPress={send} />
    {sent && <><Text style={[st.muted, { marginTop: 10 }]}>Check your inbox, then:</Text><Btn label="I’ve verified — continue" secondary onPress={refreshMe} /></>}
  </Card>;
}
function OnbTerms({ refreshMe }: any) {
  const [doc] = useAsync(() => api.legalDoc('terms_of_business'));
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  async function accept() { setBusy(true); try { await api.acceptTerms(); await refreshMe(); } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : ''); } finally { setBusy(false); } }
  return <Card>
    <Text style={st.cardT}>{doc?.document?.title ?? 'Terms of Business'}</Text>
    <Text style={[st.muted, { marginBottom: 8 }]}>Last updated {doc?.document?.updated ?? '—'}.</Text>
    <ScrollView style={{ maxHeight: 260, borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.surf2, padding: 12 }}>
      <Text style={{ fontSize: 13, lineHeight: 20, color: C.ink }}>{doc?.document?.body ?? 'Loading…'}</Text>
    </ScrollView>
    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }} onPress={() => setAgree(!agree)}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: agree ? C.brand : C.line, backgroundColor: agree ? C.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{agree && <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text>}</View>
      <Text style={{ fontSize: 14, flex: 1 }}>I have read and accept the Terms of Business</Text>
    </TouchableOpacity>
    <Btn label="Accept & continue" busy={busy} disabled={!agree} onPress={accept} />
  </Card>;
}
function OnbPlan({ refreshMe }: any) {
  const [data] = useAsync(() => api.plans());
  const [busy, setBusy] = useState('');
  async function choose(key: string) {
    setBusy(key);
    try { const r = await api.choosePlan(key); if (r.mode === 'checkout' && r.url) { Alert.alert('Complete payment', 'Continue in your browser to finish, then return to the app.'); } else { await refreshMe(); } }
    catch (e) { Alert.alert('Could not select plan', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); }
  }
  if (!data) return <Loading />;
  return <View>
    <Text style={[st.cardT, { marginBottom: 4 }]}>Choose your plan</Text>
    <Text style={[st.muted, { marginBottom: 8 }]}>Pick the plan that suits your household. Change or cancel any time.</Text>
    {(data.plans ?? []).map((p: any) => (
      <View key={p.key} style={st.recCard}>
        <View style={st.recTop}><Text style={st.recIc}>💳</Text>
          <View style={{ flex: 1 }}><Text style={st.itemT}>{p.name}</Text><Text style={st.itemS}>{p.amount ? `£${(p.amount / 100).toFixed(0)}/yr` : 'Free'} · {p.entitlements?.members === -1 ? 'unlimited' : p.entitlements?.members} members{p.entitlements?.aiAssistant ? ' · AI' : ''}</Text></View>
          <TouchableOpacity style={st.smBtn} disabled={!!busy} onPress={() => choose(p.key)}><Text style={st.smBtnTxt}>{busy === p.key ? '…' : p.amount === 0 ? 'Start free' : 'Choose'}</Text></TouchableOpacity>
        </View>
      </View>
    ))}
  </View>;
}

const TOUR_SLIDES = [
  { ic: '🗄️', t: 'Your Vault', s: 'Scan or upload documents — Vaulmo reads the details and keeps everything in one secure place.' },
  { ic: '✅', t: 'Personalise & checklist', s: 'Answer a few questions and Vaulmo suggests exactly the documents your household should keep.' },
  { ic: '🔔', t: 'Reminders', s: 'Renewals for passports, MOT, insurance and more — tracked automatically so nothing slips.' },
  { ic: '💬', t: 'Ask Vaulmo', s: 'Ask questions in plain English — answers come only from your own information.' },
  { ic: '🔒', t: 'Private by design', s: 'Your data is encrypted and access is strictly controlled. It’s your vault.' },
];
function WelcomeTour({ me, goSettings, onClose }: any) {
  const [phase, setPhase] = useState<'intro' | 'tour'>('intro');
  const [i, setI] = useState(0);
  return <View style={{ flex: 1, backgroundColor: 'rgba(16,22,35,0.55)', justifyContent: 'center', padding: 20 }}>
    <View style={[st.card, { margin: 0 }]}>
      {phase === 'intro' ? <>
        <Text style={{ fontSize: 40, textAlign: 'center' }}>👋</Text>
        <Text style={[st.cardT, { textAlign: 'center', fontSize: 18 }]}>Welcome to Vaulmo, {me.fullName?.split(' ')[0]}</Text>
        <Text style={[st.muted, { textAlign: 'center' }]}>You’re all set up. Want a 60-second tour of the essentials?</Text>
        {!me.mfaEnabled && <TouchableOpacity style={[st.promptCardSm, { marginTop: 12 }]} onPress={goSettings}>
          <View style={{ flex: 1 }}><Text style={st.promptTitleSm}>Protect your account</Text><Text style={st.promptBodySm}>Add two-factor authentication for extra security.</Text></View>
          <Text style={st.chev}>›</Text>
        </TouchableOpacity>}
        <Btn label="Start the tour" onPress={() => setPhase('tour')} />
        <Btn label="Skip" secondary onPress={onClose} />
        <TouchableOpacity style={{ alignItems: 'center', marginTop: 8 }} onPress={onClose}><Text style={st.link}>Don’t show again</Text></TouchableOpacity>
      </> : <>
        <Text style={{ fontSize: 40, textAlign: 'center' }}>{TOUR_SLIDES[i].ic}</Text>
        <Text style={[st.cardT, { textAlign: 'center', fontSize: 18 }]}>{TOUR_SLIDES[i].t}</Text>
        <Text style={[st.muted, { textAlign: 'center', minHeight: 52 }]}>{TOUR_SLIDES[i].s}</Text>
        <View style={{ flexDirection: 'row', gap: 5, justifyContent: 'center', marginVertical: 10 }}>{TOUR_SLIDES.map((_, n) => <View key={n} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: n === i ? C.brand : C.line }} />)}</View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <TouchableOpacity style={[st.btn, st.btnSec, { flex: 1 }]} onPress={onClose}><Text style={[st.btnTxt, { color: C.brand }]}>Skip</Text></TouchableOpacity>
          <TouchableOpacity style={[st.btn, { flex: 1 }]} onPress={() => i < TOUR_SLIDES.length - 1 ? setI(i + 1) : onClose()}><Text style={st.btnTxt}>{i < TOUR_SLIDES.length - 1 ? 'Next' : 'Get started'}</Text></TouchableOpacity>
        </View>
      </>}
    </View>
  </View>;
}

// Optional two-factor popup. Fully skippable; 2FA can be enabled later from You → Settings.
function TwoFactorPrompt({ onSetup, onNotNow }: any) {
  return <View style={{ flex: 1, backgroundColor: 'rgba(16,22,35,0.55)', justifyContent: 'center', padding: 20 }}>
    <View style={[st.card, { margin: 0 }]}>
      <Text style={{ fontSize: 38, textAlign: 'center' }}>🔐</Text>
      <Text style={[st.cardT, { textAlign: 'center', fontSize: 18 }]}>Add extra security?</Text>
      <Text style={[st.muted, { textAlign: 'center' }]}>Two-factor authentication adds a second step at sign-in using an authenticator app, so your password alone isn’t enough. It’s optional — set it up now, or any time later from You → Settings.</Text>
      <Btn label="Set up two-factor" onPress={onSetup} />
      <Btn label="Not now" secondary onPress={onNotNow} />
    </View>
  </View>;
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

const MAX_SCAN_PAGES = 15; // matches the server's per-PDF OCR page cap

function Capture({ onClose, onStored }: { onClose: () => void; onStored: () => void }) {
  const [step, setStep] = useState<'choose' | 'preview' | 'pages' | 'text' | 'review'>('choose');
  const [image, setImage] = useState<{ uri: string; contentType: string; filename: string } | null>(null);
  const [pages, setPages] = useState<string[]>([]); // captured page image URIs (multi-page scan)
  const [text, setText] = useState(SAMPLE);
  const [doc, setDoc] = useState<any>(null);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [typeKey, setTypeKey] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [cat] = useAsync(() => api.catalogue().catch(() => ({ types: [] })));
  const types = cat?.types ?? [];
  const chosenType = types.find((t: any) => t.key === typeKey);
  const fields = (doc?.extracted?.length ? doc.extracted : (chosenType?.fields ?? [])) as any[];

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

  // Multi-page scan (VLT-05): capture pages one at a time, then combine into a
  // single PDF on-device and upload it — the server OCRs every page.
  async function addPage(from: 'camera' | 'library') {
    setErr('');
    if (pages.length >= MAX_SCAN_PAGES) { setErr(`You can combine up to ${MAX_SCAN_PAGES} pages.`); return; }
    try {
      const perm = from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr(`Please allow ${from === 'camera' ? 'camera' : 'photo'} access in Settings to continue.`); return; }
      const res = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, allowsMultipleSelection: true, selectionLimit: MAX_SCAN_PAGES - pages.length });
      if (res.canceled || !res.assets?.length) return;
      const added: string[] = [];
      for (const a of res.assets.slice(0, MAX_SCAN_PAGES - pages.length)) {
        const m = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: 1600 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
        added.push(m.uri);
      }
      setPages((p) => [...p, ...added]);
      setStep('pages');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the page.'); }
  }
  const removePage = (i: number) => setPages((p) => p.filter((_, idx) => idx !== i));
  const movePage = (i: number, dir: -1 | 1) => setPages((p) => {
    const j = i + dir; if (j < 0 || j >= p.length) return p;
    const next = [...p]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  // Build a PDF from the captured page images (one image per page) and upload it.
  async function combinePagesAndScan() {
    if (!pages.length) return;
    setBusy('Combining pages…'); setErr('');
    try {
      const blocks: string[] = [];
      for (const uri of pages) {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        blocks.push(`<div class="pg"><img src="data:image/jpeg;base64,${b64}" /></div>`);
      }
      const html = `<!doctype html><html><head><meta charset="utf-8" />
        <style>@page{margin:0} html,body{margin:0;padding:0} .pg{page-break-after:always;display:flex;align-items:center;justify-content:center;height:100vh} .pg:last-child{page-break-after:auto} img{max-width:100%;max-height:100%}</style>
        </head><body>${blocks.join('')}</body></html>`;
      const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });
      await processUpload(pdfUri, 'application/pdf', `scan-${pages.length}p.pdf`, `Scanned document (${pages.length} pages)`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not combine the pages.'); setBusy(''); }
  }

  // Pick any file (PDF, image, doc) and upload it directly.
  async function pickFile() {
    setErr('');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*', 'text/plain'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      await processUpload(a.uri, a.mimeType || 'application/octet-stream', a.name || 'document', a.name?.replace(/\.[^.]+$/, '') || 'Document');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not open the file.'); }
  }

  async function processUpload(uri: string, contentType: string, filename: string, docTitle: string) {
    setBusy('Uploading…'); setErr('');
    try {
      const size = await fileSize(uri);
      const init = await api.createDocument({ filename, contentType, sizeBytes: size, title: docTitle });
      await uploadImage(init.uploadUrl, uri, contentType);
      setBusy('Reading…');
      const r = await api.processDocument(init.documentId);
      finishProcess(init.documentId, r, docTitle);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Upload failed. Please try again.'); setBusy(''); }
  }
  async function scanImage() {
    if (!image) return;
    await processUpload(image.uri, image.contentType, image.filename, 'Scanned document');
  }
  async function scanText() {
    setBusy('Reading…'); setErr('');
    try {
      const bytes = new Blob([text]).size;
      const init = await api.createDocument({ filename: 'doc.txt', contentType: 'text/plain', sizeBytes: bytes, title: 'Document' });
      await uploadText(init.uploadUrl, text);
      const r = await api.processDocument(init.documentId);
      finishProcess(init.documentId, r, 'Document');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not read the text.'); setBusy(''); }
  }
  function finishProcess(id: string, r: any, fallbackTitle: string) {
    const m: Record<string, string> = {};
    (r.extracted ?? []).forEach((fld: any) => { if (fld.value) m[fld.key] = fld.value; });
    setDoc({ id, extracted: r.extracted ?? [], classification: r.classification, engine: r.engine });
    setTitle(r.classification?.title ?? fallbackTitle);
    setTypeKey(r.classification?.typeKey ?? '');
    setMeta(m); setBusy(''); setStep('review');
  }
  async function confirm() {
    setBusy('Storing…');
    try {
      if (typeKey || title) await api.editDocument(doc.id, { ...(typeKey ? { typeKey } : {}), ...(title ? { title } : {}) });
      await api.confirmDocument(doc.id, meta);
      onStored();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not store.'); setBusy(''); }
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
            <Text style={st.muted}>Snap a photo, choose an image, or upload a file — Vaulmo reads the details for you.</Text>
            {busy ? <View style={{ paddingVertical: 30 }}><Loading /><Text style={[st.muted, { textAlign: 'center' }]}>{busy}</Text></View> : <>
              <TouchableOpacity style={st.bigChoice} activeOpacity={0.9} onPress={() => pick('camera')}>
                <Text style={st.bigChoiceIc}>📷</Text><Text style={st.bigChoiceT}>Take a photo</Text><Text style={st.bigChoiceS}>Use your camera to scan</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.bigChoice} activeOpacity={0.9} onPress={() => pick('library')}>
                <Text style={st.bigChoiceIc}>🖼️</Text><Text style={st.bigChoiceT}>Choose from library</Text><Text style={st.bigChoiceS}>Pick an existing photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.bigChoice} activeOpacity={0.9} onPress={() => addPage('camera')}>
                <Text style={st.bigChoiceIc}>📚</Text><Text style={st.bigChoiceT}>Scan multiple pages</Text><Text style={st.bigChoiceS}>Combine several pages into one PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.bigChoice} activeOpacity={0.9} onPress={pickFile}>
                <Text style={st.bigChoiceIc}>📎</Text><Text style={st.bigChoiceT}>Upload a file</Text><Text style={st.bigChoiceS}>PDF or image from your device</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={() => setStep('text')}><Text style={st.link}>Type or paste text instead</Text></TouchableOpacity>
            </>}
          </>}

          {step === 'preview' && image && <>
            <Image source={{ uri: image.uri }} style={st.preview} resizeMode="contain" />
            <Btn label="Scan this document" busy={!!busy} busyLabel={busy} onPress={scanImage} />
            <Btn label="Retake" secondary onPress={() => { setImage(null); setStep('choose'); }} />
          </>}

          {step === 'pages' && <>
            {busy ? <View style={{ paddingVertical: 30 }}><Loading /><Text style={[st.muted, { textAlign: 'center' }]}>{busy}</Text></View> : <>
              <Text style={st.muted}>{pages.length} page{pages.length === 1 ? '' : 's'} added. Reorder or remove pages, add more, then combine them into a single PDF.</Text>
              {pages.map((uri, i) => (
                <View key={`${uri}-${i}`} style={st.pageRow}>
                  <Image source={{ uri }} style={st.pageThumb} resizeMode="cover" />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={st.itemT}>Page {i + 1}</Text>
                    <View style={{ flexDirection: 'row', gap: 14, marginTop: 6 }}>
                      <TouchableOpacity disabled={i === 0} onPress={() => movePage(i, -1)}><Text style={[st.link, i === 0 && { color: C.line }]}>↑ Up</Text></TouchableOpacity>
                      <TouchableOpacity disabled={i === pages.length - 1} onPress={() => movePage(i, 1)}><Text style={[st.link, i === pages.length - 1 && { color: C.line }]}>↓ Down</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => removePage(i)}><Text style={[st.link, { color: C.crit }]}>Remove</Text></TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <View style={{ flex: 1 }}><Btn label="📷 Add page" secondary onPress={() => addPage('camera')} /></View>
                <View style={{ flex: 1 }}><Btn label="🖼️ From library" secondary onPress={() => addPage('library')} /></View>
              </View>
              <Btn label={`Combine ${pages.length} page${pages.length === 1 ? '' : 's'} & scan`} busy={!!busy} busyLabel={busy} onPress={combinePagesAndScan} />
              <Btn label="Cancel" secondary onPress={() => { setPages([]); setStep('choose'); }} />
            </>}
          </>}

          {step === 'text' && <>
            <Field label="Paste document text" value={text} onChangeText={setText} multiline />
            <Btn label="Scan & extract" busy={!!busy} busyLabel={busy} onPress={scanText} />
            <Btn label="Back" secondary onPress={() => setStep('choose')} />
          </>}

          {step === 'review' && doc && <>
            {doc.classification?.typeKey
              ? <View style={st.okBox}><Text style={st.okTxt}>Recognised as {doc.classification.typeKey} ({Math.round((doc.classification?.confidence ?? 0) * 100)}% · {doc.engine})</Text></View>
              : <View style={[st.okBox, { backgroundColor: C.warnBg }]}><Text style={{ color: C.warn, fontWeight: '600', fontSize: 13 }}>We couldn't read this automatically — name it and pick a type below, or just store it.</Text></View>}
            <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. My passport" />
            <Text style={[st.fieldLabel, { marginTop: 12 }]}>Document type</Text>
            <View style={st.chipRow}>
              <TouchableOpacity style={[st.chip, !typeKey && st.chipOn]} onPress={() => { setTypeKey(''); }}><Text style={[st.chipTxt, !typeKey && st.chipTxtOn]}>Unspecified</Text></TouchableOpacity>
              {types.slice(0, 12).map((t: any) => <TouchableOpacity key={t.key} style={[st.chip, typeKey === t.key && st.chipOn]} onPress={() => { setTypeKey(t.key); setMeta({}); }}><Text style={[st.chipTxt, typeKey === t.key && st.chipTxtOn]}>{t.name}</Text></TouchableOpacity>)}
            </View>
            {fields.map((fld: any) => (
              <Field key={fld.key} label={fld.label} value={meta[fld.key] ?? ''} onChangeText={(v: string) => setMeta((s) => ({ ...s, [fld.key]: v }))} />
            ))}
            <Btn label="Confirm & store" busy={!!busy} busyLabel={busy} onPress={confirm} />
            <Btn label="Start over" secondary onPress={() => { setDoc(null); setImage(null); setPages([]); setTypeKey(''); setTitle(''); setStep('choose'); }} />
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

function Profile({ me, refreshMe, onSignOut, openSub }: any) {
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

      <SectionTitle>Your life</SectionTitle>
      <MenuItem ic="🗓️" bg={C.warnBg} t="Renewals & Expiries" s="Everything coming due" onPress={() => openSub('renewals')} />
      <MenuItem ic="🔒" bg={C.goodBg} t="Password Vault" s="Passwords, cards & notes" onPress={() => openSub('passwords')} />
      <MenuItem ic="🪪" bg={C.brandSoft} t="Passport Photo" s="Take a compliant photo" onPress={() => openSub('passport')} />
      <MenuItem ic="🚗" bg={C.brandSoft} t="Property & Vehicles" s="Home, car & renewals" onPress={() => openSub('assets')} />
      <MenuItem ic="📍" bg={C.warnBg} t="Driving charges" s="ULEZ, congestion & toll alerts" onPress={() => openSub('driving')} />
      <MenuItem ic="✈️" bg={C.brandSoft} t="Trips" s="Flights, hotels & tickets" onPress={() => openSub('trips')} />
      <MenuItem ic="🧾" bg={C.goodBg} t="Purchases & Warranties" s="Receipts, assets & cover" onPress={() => openSub('purchases')} />
      <MenuItem ic="🔁" bg={C.warnBg} t="Subscriptions" s="What you pay for" onPress={() => openSub('subs')} />
      <MenuItem ic="🔌" bg={C.violetBg} t="Connected Services" s="Import from email" onPress={() => openSub('connected')} />

      <SectionTitle>People & access</SectionTitle>
      <MenuItem ic="👪" bg={C.brandSoft} t="Family & Access" s="Members & next of kin" onPress={() => openSub('family')} />
      <MenuItem ic="🛡️" bg={C.goodBg} t="Emergency Access" s="Requests to reach your vault" onPress={() => openSub('emergency')} />

      <SectionTitle>Account</SectionTitle>
      {!me.mfaEnabled && <MenuItem ic="🔐" bg={C.warnBg} t="Enable two-factor" s="Optional — add a second sign-in step" onPress={() => openSub('settings')} />}
      <MenuItem ic="💳" bg={C.violetBg} t="Plan & Billing" s="Your subscription" onPress={() => openSub('billing')} />
      <MenuItem ic="🔐" bg={C.goodBg} t="Privacy & Security" s="Activity, export & data" onPress={() => openSub('privacy')} />
      <MenuItem ic="⚙️" bg={C.surf2} t="Settings" s="Security & notifications" onPress={() => openSub('settings')} />
      <MenuItem ic="💬" bg={C.surf2} t="Support" s="Get help & track requests" onPress={() => openSub('support')} />
      <MenuItem ic="❓" bg={C.surf2} t="FAQ & Support" s="Common questions" onPress={() => openSub('faq')} />
      <MenuItem ic="📚" bg={C.surf2} t="Help Centre" s="Guides & answers" onPress={() => openSub('help')} />

      <View style={{ height: 10 }} />
      <Btn label="Sign out" secondary onPress={onSignOut} />
    </ScrollView>
  );
}
const MenuItem = ({ ic, bg, t, s, onPress }: any) => (
  <TouchableOpacity style={st.item} activeOpacity={0.8} onPress={onPress}>
    <View style={[st.itemIc, { backgroundColor: bg }]}><Text style={{ fontSize: 18 }}>{ic}</Text></View>
    <View style={{ flex: 1 }}><Text style={st.itemT}>{t}</Text><Text style={st.itemS}>{s}</Text></View>
    <Text style={st.chev}>›</Text>
  </TouchableOpacity>
);

/* ============================ sub-screens ============================ */
function SubScreen({ title, onClose, children }: any) {
  return (
    <SafeAreaView style={st.safe}><StatusBar style="dark" />
      <View style={st.modalTop}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[st.modalClose, { fontSize: 24, marginRight: 2 }]}>‹</Text><Text style={{ color: C.brand, fontWeight: '700', fontSize: 15 }}>Back</Text>
        </TouchableOpacity>
        <Text style={st.modalTitle}>{title}</Text><View style={{ width: 48 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// A small reusable "add record" form toggler used by the life screens.
function AddToggle({ open, onToggle }: any) {
  return <TouchableOpacity style={st.smBtn} onPress={onToggle}><Text style={st.smBtnTxt}>{open ? 'Close' : '+ Add'}</Text></TouchableOpacity>;
}

function Trips() {
  const [data, reload] = useAsync(() => api.trips());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', destination: '', startDate: '', endDate: '' });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!f.title.trim()) { Alert.alert('Add a title'); return; }
    setBusy(true);
    try { await api.createTrip({ ...f, title: f.title.trim() }); setF({ title: '', destination: '', startDate: '', endDate: '' }); setOpen(false); await reload(); }
    catch (e) { Alert.alert('Could not add', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  if (!data) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={st.spread}><Text style={st.section}>Your trips</Text><AddToggle open={open} onToggle={() => setOpen(!open)} /></View>
    {open && <Card>
      <Field label="Title" value={f.title} onChangeText={(v: string) => setF({ ...f, title: v })} placeholder="Paris break" />
      <Field label="Destination" value={f.destination} onChangeText={(v: string) => setF({ ...f, destination: v })} placeholder="Paris" />
      <Field label="Start date (YYYY-MM-DD)" value={f.startDate} onChangeText={(v: string) => setF({ ...f, startDate: v })} placeholder="2026-09-10" />
      <Field label="End date (YYYY-MM-DD)" value={f.endDate} onChangeText={(v: string) => setF({ ...f, endDate: v })} placeholder="2026-09-14" />
      <Btn label="Add trip" busy={busy} onPress={add} />
    </Card>}
    {(data.trips ?? []).length ? (data.trips ?? []).map((t: any) => (
      <Item key={t.id} icon="✈️" t={t.title} sub={`${t.destination ?? '—'}${t.startDate ? ` · ${fmt(t.startDate)}` : ''}`} badge={t.items?.length ? `${t.items.length} items` : undefined} />
    )) : <Card><Text style={st.muted}>No trips yet. Add one, or connect your email so Vaulmo can spot them for you.</Text></Card>}
  </ScrollView>;
}

function Purchases() {
  const [data, reload] = useAsync(() => api.purchases());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ item: '', merchant: '', amount: '', purchaseDate: '', warrantyExpiry: '' });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!f.item.trim()) { Alert.alert('Add an item name'); return; }
    setBusy(true);
    try { await api.createPurchase({ ...f, item: f.item.trim() }); setF({ item: '', merchant: '', amount: '', purchaseDate: '', warrantyExpiry: '' }); setOpen(false); await reload(); }
    catch (e) { Alert.alert('Could not add', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  if (!data) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={st.spread}><Text style={st.section}>Purchases & warranties</Text><AddToggle open={open} onToggle={() => setOpen(!open)} /></View>
    {open && <Card>
      <Field label="Item" value={f.item} onChangeText={(v: string) => setF({ ...f, item: v })} placeholder="Bosch washing machine" />
      <Field label="Merchant" value={f.merchant} onChangeText={(v: string) => setF({ ...f, merchant: v })} placeholder="Currys" />
      <Field label="Amount" value={f.amount} onChangeText={(v: string) => setF({ ...f, amount: v })} placeholder="£499" />
      <Field label="Purchase date (YYYY-MM-DD)" value={f.purchaseDate} onChangeText={(v: string) => setF({ ...f, purchaseDate: v })} placeholder="2026-01-10" />
      <Field label="Warranty expiry (YYYY-MM-DD)" value={f.warrantyExpiry} onChangeText={(v: string) => setF({ ...f, warrantyExpiry: v })} placeholder="2031-01-10" />
      <Btn label="Add purchase" busy={busy} onPress={add} />
    </Card>}
    {(data.purchases ?? []).length ? (data.purchases ?? []).map((p: any) => (
      <Item key={p.id} icon="🧾" t={p.item} sub={`${p.merchant ?? '—'}${p.amount ? ` · ${p.amount}` : ''}`} right={p.warrantyExpiry ? <DuePill dueDate={p.warrantyExpiry} /> : undefined} />
    )) : <Card><Text style={st.muted}>No purchases yet. Add receipts and warranties to get renewal reminders.</Text></Card>}
  </ScrollView>;
}

function Subs() {
  const [data, reload] = useAsync(() => api.trackedSubscriptions());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', category: '', amount: '', cycle: '', renewalDate: '' });
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!f.name.trim()) { Alert.alert('Add a name'); return; }
    setBusy(true);
    try { await api.createSubscription({ ...f, name: f.name.trim() }); setF({ name: '', category: '', amount: '', cycle: '', renewalDate: '' }); setOpen(false); await reload(); }
    catch (e) { Alert.alert('Could not add', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  if (!data) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={st.spread}><Text style={st.section}>Subscriptions</Text><AddToggle open={open} onToggle={() => setOpen(!open)} /></View>
    {open && <Card>
      <Field label="Name" value={f.name} onChangeText={(v: string) => setF({ ...f, name: v })} placeholder="Netflix" />
      <Field label="Category" value={f.category} onChangeText={(v: string) => setF({ ...f, category: v })} placeholder="Streaming" />
      <Field label="Amount" value={f.amount} onChangeText={(v: string) => setF({ ...f, amount: v })} placeholder="£10.99" />
      <Field label="Cycle" value={f.cycle} onChangeText={(v: string) => setF({ ...f, cycle: v })} placeholder="monthly" />
      <Field label="Renewal date (YYYY-MM-DD)" value={f.renewalDate} onChangeText={(v: string) => setF({ ...f, renewalDate: v })} placeholder="2026-12-01" />
      <Btn label="Add subscription" busy={busy} onPress={add} />
    </Card>}
    {(data.subscriptions ?? []).length ? (data.subscriptions ?? []).map((sb: any) => (
      <Item key={sb.id} icon="🔁" t={sb.name} sub={`${sb.category ?? '—'}${sb.amount ? ` · ${sb.amount}${sb.cycle ? `/${sb.cycle}` : ''}` : ''}`} right={sb.renewalDate ? <DuePill dueDate={sb.renewalDate} /> : undefined} />
    )) : <Card><Text style={st.muted}>Nothing tracked yet. Add what you pay for to get renewal reminders.</Text></Card>}
  </ScrollView>;
}

const ASSET_FIELDS: Record<string, { key: string; label: string; date?: boolean }[]> = {
  vehicle: [{ key: 'registration', label: 'Registration' }, { key: 'make', label: 'Make & model' }, { key: 'motDate', label: 'MOT due (YYYY-MM-DD)', date: true }, { key: 'taxDate', label: 'Road tax due (YYYY-MM-DD)', date: true }, { key: 'insuranceDate', label: 'Insurance renewal (YYYY-MM-DD)', date: true }],
  property: [{ key: 'address', label: 'Address' }, { key: 'ownership', label: 'Owned / rented' }, { key: 'insuranceDate', label: 'Home insurance renewal (YYYY-MM-DD)', date: true }, { key: 'mortgageEnd', label: 'Mortgage deal ends (YYYY-MM-DD)', date: true }],
};
function AssetItem({ a, docs, onChange }: any) {
  const [data, reload] = useAsync(() => api.asset(a.id), [a.id]);
  const [edit, setEdit] = useState(false);
  const [details, setDetails] = useState<any>(a.details ?? {});
  const [pick, setPick] = useState('');
  const fields = ASSET_FIELDS[a.kind] ?? [];
  const linked = data?.documents ?? [];
  const assignable = (docs ?? []).filter((d: any) => d.assetId !== a.id);
  async function save() { try { await api.updateAsset(a.id, { details }); setEdit(false); onChange?.(); } catch (e) { Alert.alert('Could not save', e instanceof ApiError ? e.message : ''); } }
  function remove() { Alert.alert('Remove', `Remove “${a.name}”?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await api.deleteAsset(a.id); onChange?.(); } }]); }
  async function link(id: string) { await api.assignDocumentAsset(id, a.id); setPick(''); await reload(); onChange?.(); }
  return <View style={st.recCard}>
    <View style={st.recTop}>
      <Text style={st.recIc}>{a.kind === 'vehicle' ? '🚗' : '🏠'}</Text>
      <View style={{ flex: 1 }}><Text style={st.itemT}>{a.name}</Text><Text style={st.itemS}>{a.kind}</Text></View>
      <TouchableOpacity onPress={() => setEdit(!edit)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={{ color: C.brand, fontWeight: '700', fontSize: 13 }}>{edit ? 'Cancel' : 'Edit'}</Text></TouchableOpacity>
    </View>
    {!edit ? <View style={{ marginTop: 8 }}>
      {fields.filter((f) => a.details?.[f.key]).map((f) => (
        <View key={f.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
          <Text style={st.itemS}>{f.label.replace(/ \(.*\)/, '')}</Text>
          {f.date ? <DuePill dueDate={a.details[f.key]} /> : <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink }}>{a.details[f.key]}</Text>}
        </View>
      ))}
      {!fields.some((f) => a.details?.[f.key]) && <Text style={st.itemS}>No details yet — tap Edit to add renewal dates.</Text>}
    </View> : <View style={{ marginTop: 6 }}>
      {fields.map((f) => <Field key={f.key} label={f.label} value={details[f.key] ?? ''} onChangeText={(v: string) => setDetails({ ...details, [f.key]: v })} />)}
      <Btn label="Save" onPress={save} />
    </View>}
    <View style={{ borderTopWidth: 1, borderTopColor: C.line, marginTop: 10, paddingTop: 8 }}>
      <Text style={[st.itemS, { fontWeight: '700' }]}>Documents ({linked.length})</Text>
      {linked.map((d: any) => <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}><Text style={{ fontSize: 13 }}>📄 {d.title}</Text><TouchableOpacity onPress={() => api.assignDocumentAsset(d.id, null).then(reload)}><Text style={{ color: C.brand, fontSize: 12.5 }}>Remove</Text></TouchableOpacity></View>)}
      {assignable.length > 0 && <View style={st.chipRow}>{assignable.slice(0, 6).map((d: any) => <TouchableOpacity key={d.id} style={st.chip} onPress={() => link(d.id)}><Text style={st.chipTxt} numberOfLines={1}>＋ {d.title}</Text></TouchableOpacity>)}</View>}
      <View style={{ height: 6 }} />
      <TouchableOpacity onPress={remove}><Text style={{ color: C.crit, fontSize: 12.5, fontWeight: '600' }}>Remove asset</Text></TouchableOpacity>
    </View>
  </View>;
}
const EXP_ICON: Record<string, string> = { Vehicle: '🚗', Property: '🏠', Subscription: '🔁', Warranty: '🛡️', Document: '📄', Renewal: '🗓️' };
function Renewals() {
  const [within, setWithin] = useState(365);
  const [data] = useAsync(() => api.expiries(within), [within]);
  const daysLabel = (d: number) => (d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d`);
  const pill = (d: number) => (d < 0 ? { backgroundColor: C.critBg, color: C.crit } : d <= 30 ? { backgroundColor: C.critBg, color: C.crit } : d <= 90 ? { backgroundColor: C.warnBg, color: C.warn } : { backgroundColor: C.goodBg, color: C.good });
  const b = data?.buckets ?? { overdue: [], soon: [], upcoming: [], later: [] };
  const total = data?.counts?.total ?? 0;
  const group = (title: string, list: any[]) => list.length > 0 && (
    <View key={title}>
      <SectionTitle>{title} ({list.length})</SectionTitle>
      <Card>
        {list.map((i: any) => (
          <Item key={`${i.category}-${i.dueDate}-${i.title}`} icon={EXP_ICON[i.category] ?? '🗓️'} t={i.title} sub={`${i.category} · ${fmt(i.dueDate)}`}
            right={<Text style={[st.tag, pill(i.daysRemaining)]}>{daysLabel(i.daysRemaining)}</Text>} />
        ))}
      </Card>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <Text style={st.muted}>Everything coming due — document expiries, MOT, tax, insurance, warranties and subscription renewals — in one place.</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {[[90, '3 mo'], [180, '6 mo'], [365, '1 yr'], [730, '2 yr']].map(([d, lbl]) => (
          <TouchableOpacity key={d as number} onPress={() => setWithin(d as number)} accessibilityRole="button" accessibilityState={{ selected: within === d }}
            style={[st.chip, within === d && st.chipOn]}><Text style={[st.chipTxt, within === d && st.chipTxtOn]}>{lbl as string}</Text></TouchableOpacity>
        ))}
      </View>
      {!data ? <Loading /> : total === 0
        ? <Card><Text style={[st.muted, { textAlign: 'center', paddingVertical: 16 }]}>Nothing coming due in this window. 🎉</Text></Card>
        : <>{group('Overdue', b.overdue)}{group('Due soon', b.soon)}{group('Upcoming', b.upcoming)}{group('Later', b.later)}</>}
    </ScrollView>
  );
}
function PassportPhoto() {
  const [orig, setOrig] = useState<string | null>(null);
  const [result, setResult] = useState<{ preview: string; meta: any } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function capture(from: 'camera' | 'library') {
    setErr('');
    try {
      const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr(`Please allow ${from === 'camera' ? 'camera' : 'photo'} access to continue.`); return; }
      const res = from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
      if (res.canceled || !res.assets?.length) return;
      const m = await ImageManipulator.manipulateAsync(res.assets[0].uri, [{ resize: { width: 1200 } }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
      setOrig(m.uri); setResult(null);
      setBusy('Creating your passport photo…');
      const r = await processPassport(m.uri, false);
      setResult({ preview: r.preview, meta: r.meta });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not process the photo.'); }
    finally { setBusy(''); }
  }
  async function save() {
    if (!orig) return; setBusy('Saving to your vault…'); setErr('');
    try { await processPassport(orig, true); Alert.alert('Saved', 'Your passport photo is in the vault.'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save.'); }
    finally { setBusy(''); }
  }

  return (
    <ScrollView contentContainerStyle={st.pad}>
      {!!err && <View style={st.errBox}><Text style={st.errTxt}>{err}</Text></View>}
      <Text style={st.muted}>Take a head-and-shoulders photo facing the camera. Tips for the best result: plain wall behind you, even lighting, neutral expression, no hat or sunglasses. Vaulmo whitens the background and crops it to passport size (35×45mm).</Text>

      {result ? <>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={[st.fieldLabel, { textAlign: 'center' }]}>Your photo</Text>
            {orig && <Image source={{ uri: orig }} style={st.ppImg} resizeMode="cover" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[st.fieldLabel, { textAlign: 'center' }]}>Passport-ready</Text>
            <Image source={{ uri: result.preview }} style={st.ppImg} resizeMode="contain" />
          </View>
        </View>
        {result.meta?.facesDetected ? <View style={st.okBox}><Text style={st.okTxt}>✅ Face detected · background whitened · sized to 35×45mm</Text></View>
          : <View style={[st.okBox, { backgroundColor: C.warnBg }]}><Text style={{ color: C.warn, fontWeight: '600', fontSize: 13 }}>We couldn't clearly detect a face — retake facing the camera in good light for a compliant result.</Text></View>}
        <Btn label="Save to vault" busy={!!busy} busyLabel={busy} onPress={save} />
        <Btn label="Retake" secondary onPress={() => { setResult(null); setOrig(null); }} />
      </> : busy ? <View style={{ paddingVertical: 30 }}><Loading /><Text style={[st.muted, { textAlign: 'center' }]}>{busy}</Text></View> : <>
        <Btn label="📷 Take photo" onPress={() => capture('camera')} />
        <Btn label="🖼️ Choose from library" secondary onPress={() => capture('library')} />
      </>}
    </ScrollView>
  );
}
const PW_KIND: Record<string, { ic: string; label: string }> = {
  login: { ic: '🔑', label: 'Login' }, card: { ic: '💳', label: 'Card' }, note: { ic: '📝', label: 'Secure note' }, pin: { ic: '🔢', label: 'PIN' },
};
function Passwords() {
  const [data, reload] = useAsync(() => api.passwords());
  const [add, setAdd] = useState(false);
  const [f, setF] = useState<any>({ kind: 'login', label: '', username: '', url: '', password: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, any>>({});
  const items = data?.items ?? [];
  const set = (k: string, v: string) => setF((s: any) => ({ ...s, [k]: v }));

  async function create() {
    if (!f.label) return; setBusy(true);
    try {
      await api.createPassword({ kind: f.kind, label: f.label, username: f.username || null, url: f.url || null, secret: { password: f.password || undefined, note: f.note || undefined } });
      setF({ kind: 'login', label: '', username: '', url: '', password: '', note: '' }); setAdd(false); reload();
    } catch (e) { Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  async function reveal(id: string) {
    if (open[id]) { setOpen((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    try { const r = await api.revealPassword(id); setOpen((s) => ({ ...s, [id]: r.secret })); } catch { Alert.alert('Could not unlock'); }
  }
  function del(id: string, label: string) {
    Alert.alert('Delete item', `Delete "${label}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.deletePassword(id); reload(); } catch { Alert.alert('Try again'); } } },
    ]);
  }
  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={st.okBox}><Text style={st.okTxt}>🔒 Encrypted at rest · only you can unlock · every unlock is logged.</Text></View>
      {!add
        ? <Btn label="＋ Add item" onPress={() => setAdd(true)} />
        : <Card>
            <Picker label="Type" value={f.kind} options={Object.entries(PW_KIND).map(([k, v]) => [k, v.label]) as [string, string][]} onChange={(v) => set('kind', v)} />
            <Field label="Name" value={f.label} onChangeText={(v: string) => set('label', v)} placeholder="e.g. Gmail, Wi-Fi, Barclays" />
            {f.kind === 'login' && <>
              <Field label="Username / email" value={f.username} onChangeText={(v: string) => set('username', v)} autoCapitalize="none" />
              <Field label="Website" value={f.url} onChangeText={(v: string) => set('url', v)} autoCapitalize="none" placeholder="https://" />
            </>}
            {f.kind !== 'note' && <Field label={f.kind === 'pin' ? 'PIN' : f.kind === 'card' ? 'Card number' : 'Password'} value={f.password} onChangeText={(v: string) => set('password', v)} secureTextEntry />}
            <Field label={f.kind === 'note' ? 'Secure note' : 'Notes (optional)'} value={f.note} onChangeText={(v: string) => set('note', v)} multiline />
            <Btn label="Save securely" busy={busy} onPress={create} />
            <Btn label="Cancel" secondary onPress={() => setAdd(false)} />
          </Card>}

      {items.map((i: any) => {
        const k = PW_KIND[i.kind] ?? PW_KIND.login; const sec = open[i.id];
        return <Card key={i.id}>
          <Item icon={k.ic} t={i.label} sub={`${k.label}${i.username ? ` · ${i.username}` : ''}`}
            right={<TouchableOpacity onPress={() => reveal(i.id)} accessibilityRole="button"><Text style={st.link}>{sec ? 'Hide' : 'Reveal'}</Text></TouchableOpacity>} />
          {sec && <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line, marginTop: 4, gap: 6 }}>
            {!!sec.password && <Text selectable style={st.itemT}>{sec.password}</Text>}
            {!!sec.pin && <Text selectable style={st.itemT}>{sec.pin}</Text>}
            {!!sec.cardNumber && <Text selectable style={st.itemT}>{sec.cardNumber}</Text>}
            {!!sec.note && <Text selectable style={st.muted}>{sec.note}</Text>}
            <TouchableOpacity onPress={() => del(i.id, i.label)} accessibilityRole="button"><Text style={[st.link, { color: C.crit }]}>Delete</Text></TouchableOpacity>
          </View>}
        </Card>;
      })}
      {!items.length && !add && <Text style={[st.muted, { textAlign: 'center', marginTop: 20 }]}>Nothing saved yet. Add your first password or note.</Text>}
    </ScrollView>
  );
}
function Assets() {
  const [data, reload] = useAsync(() => api.assets());
  const [docs, reloadDocs] = useAsync(() => api.documents());
  const [adding, setAdding] = useState<null | 'vehicle' | 'property'>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim() || !adding) return;
    setBusy(true);
    try { await api.createAsset({ kind: adding, name: name.trim() }); setName(''); setAdding(null); await reload(); }
    catch (e) { Alert.alert('Could not add', e instanceof ApiError ? e.message : ''); } finally { setBusy(false); }
  }
  if (!data) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <Text style={st.muted}>Group documents and renewal dates under your home and car. Adding MOT, tax or insurance dates creates reminders automatically.</Text>
    <View style={[st.spread, { marginTop: 12 }]}>
      <Text style={st.section}>Your assets</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity style={st.smBtn} onPress={() => setAdding(adding === 'vehicle' ? null : 'vehicle')}><Text style={st.smBtnTxt}>+ Vehicle</Text></TouchableOpacity>
        <TouchableOpacity style={st.smBtn} onPress={() => setAdding(adding === 'property' ? null : 'property')}><Text style={st.smBtnTxt}>+ Property</Text></TouchableOpacity>
      </View>
    </View>
    {adding && <Card>
      <Field label={adding === 'vehicle' ? 'Vehicle name (e.g. “VW Golf”)' : 'Property name (e.g. “Home”)'} value={name} onChangeText={setName} />
      <Btn label={`Add ${adding}`} busy={busy} onPress={create} />
    </Card>}
    {(data.assets ?? []).length ? (data.assets ?? []).map((a: any) => <AssetItem key={a.id} a={a} docs={docs?.documents ?? []} onChange={() => { reload(); reloadDocs(); }} />)
      : <Card><Text style={st.muted}>No property or vehicles yet. Add your home or car to track MOT, tax and insurance renewals.</Text></Card>}
  </ScrollView>;
}

const SEC_ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Sign-in attempt', 'auth.login.success': 'Signed in', 'auth.login.mfa_challenge': 'Two-factor prompted',
  'auth.mfa.verify': 'Two-factor verified', 'auth.reset.requested': 'Password reset requested', 'auth.reset.success': 'Password reset',
  'auth.session.revoked': 'Device signed out', 'auth.session.revoked_others': 'Other devices signed out',
  'mfa.enabled': 'Two-factor enabled', 'mfa.disabled': 'Two-factor disabled', 'mfa.enroll.begin': 'Two-factor setup started',
  'user.profile.updated': 'Profile updated', 'document.downloaded': 'Document downloaded', 'document.deleted': 'Document deleted',
  'emergency.owner.approve': 'Approved emergency access', 'emergency.owner.decline': 'Declined emergency access', 'emergency.revoked': 'Revoked emergency access',
  'privacy.export': 'Data exported', 'privacy.deletion_requested': 'Account deletion requested', 'privacy.consent': 'Consent updated',
};
function PrivacySecurity() {
  const [act] = useAsync(() => api.securityActivity());
  const [priv, reloadPriv] = useAsync(() => api.privacy());
  const [busy, setBusy] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [pw, setPw] = useState('');
  const openDeletion = (priv?.requests ?? []).find((r: any) => r.type === 'deletion' && (r.status === 'pending' || r.status === 'in_progress'));
  async function doExport() {
    setBusy('export');
    try { await api.exportData(); await reloadPriv(); Alert.alert('Export ready', 'Your data export has been generated and logged. You can download the full file from the web app.'); }
    catch (e) { Alert.alert('Export failed', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); }
  }
  async function doDelete() {
    if (!pw) { Alert.alert('Enter your password to confirm'); return; }
    setBusy('delete');
    try { await api.requestDeletion(pw); setPw(''); setDelOpen(false); await reloadPriv(); Alert.alert('Request submitted', 'Your account-deletion request has been submitted. Your documents are not deleted automatically.'); }
    catch (e) { Alert.alert('Could not submit', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); }
  }
  if (!act || !priv) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <SectionTitle>Security activity</SectionTitle>
    {(act.activity ?? []).length ? (act.activity ?? []).slice(0, 12).map((a: any) => (
      <View key={a.id} style={st.item}><View style={st.itemIc}><Text style={{ fontSize: 16 }}>🔐</Text></View>
        <View style={{ flex: 1 }}><Text style={st.itemT}>{SEC_ACTION_LABEL[a.action] ?? a.action}</Text><Text style={st.itemS}>{fmt(a.at)}{a.ip ? ` · ${a.ip}` : ''}</Text></View>
      </View>
    )) : <Card><Text style={st.muted}>No recent security activity.</Text></Card>}

    <SectionTitle>Your data & privacy</SectionTitle>
    <Card>
      <View style={st.detailRow}><Text style={st.itemT}>Export my data</Text><TouchableOpacity style={st.smBtn} disabled={!!busy} onPress={doExport}><Text style={st.smBtnTxt}>{busy === 'export' ? '…' : 'Export'}</Text></TouchableOpacity></View>
      <View style={[st.detailRow, { borderBottomWidth: 0 }]}><Text style={st.itemS}>Consents: {(priv.consents ?? []).length ? (priv.consents ?? []).map((c: any) => c.policy).join(', ') : 'none recorded'}</Text></View>
    </Card>

    <SectionTitle>Delete my account</SectionTitle>
    <Card>
      <Text style={st.muted}>Raises a verified deletion request. Your documents are never deleted automatically.</Text>
      {openDeletion ? <View style={[st.okBox, { backgroundColor: C.warnBg, marginTop: 10 }]}><Text style={{ color: C.warn, fontWeight: '600', fontSize: 13 }}>Deletion request submitted — {openDeletion.status}</Text></View>
        : !delOpen ? <Btn label="Request account deletion" secondary onPress={() => setDelOpen(true)} />
        : <>
          <Field label="Confirm your password" value={pw} onChangeText={setPw} secureTextEntry />
          <Btn label="Submit deletion request" busy={busy === 'delete'} onPress={doDelete} />
          <Btn label="Cancel" secondary onPress={() => { setDelOpen(false); setPw(''); }} />
        </>}
    </Card>
  </ScrollView>;
}

function Connected() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => { api.providers().then(() => setAvailable(true)).catch(() => setAvailable(false)); }, []);
  const [conns, rc] = useAsync(() => api.connections().catch(() => ({ connections: [] })));
  const [det, rd] = useAsync(() => api.detected().catch(() => ({ detected: [] })));
  const [busy, setBusy] = useState('');
  if (available === null) return <Loading />;
  if (available === false) return <ScrollView contentContainerStyle={st.pad}>
    <View style={[st.okBox, { backgroundColor: C.warnBg }]}><Text style={{ color: C.warn, fontWeight: '600', fontSize: 13.5 }}>⏳ Connected Services are coming soon</Text></View>
    <Text style={st.muted}>Soon you'll be able to securely connect Gmail or Outlook so Vaulmo can spot trips, receipts and warranties automatically — you'll always confirm before anything is added. We'll switch this on for your account shortly.</Text>
  </ScrollView>;
  async function connect(p: string) { setBusy(p); try { await api.connect(p); await api.callback(p, 'demo_' + p); await rc(); } catch (e) { Alert.alert('Could not connect', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(''); } }
  async function sync(id: string) { setBusy(id); try { await api.sync(id); await rd(); } catch (e) { Alert.alert('Sync failed', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); } }
  async function pause(id: string) { setBusy(id); try { await api.pauseConnection(id); await rc(); } catch { Alert.alert('Try again'); } finally { setBusy(''); } }
  async function resume(id: string) { setBusy(id); try { await api.resumeConnection(id); await rc(); } catch { Alert.alert('Try again'); } finally { setBusy(''); } }
  async function add(id: string) { try { await api.confirmDetected(id); await rd(); } catch { Alert.alert('Try again'); } }
  async function dismiss(id: string) { try { await api.dismissDetected(id); await rd(); } catch { Alert.alert('Try again'); } }
  return <ScrollView contentContainerStyle={st.pad}>
    <Text style={st.muted}>Securely connect your email so Vaulmo can spot trips, receipts and warranties. You confirm before anything is added.</Text>
    <SectionTitle>Connect a service</SectionTitle>
    {['gmail', 'outlook'].map((p) => (
      <View key={p} style={st.item}>
        <View style={st.itemIc}><Text style={{ fontSize: 18 }}>{p === 'gmail' ? '📧' : '📨'}</Text></View>
        <View style={{ flex: 1 }}><Text style={st.itemT}>{p === 'gmail' ? 'Gmail' : 'Outlook'}</Text></View>
        <TouchableOpacity style={st.smBtn} disabled={!!busy} onPress={() => connect(p)}><Text style={st.smBtnTxt}>{busy === p ? '…' : 'Connect'}</Text></TouchableOpacity>
      </View>
    ))}
    <SectionTitle>Your connections</SectionTitle>
    {(conns?.connections ?? []).filter((c: any) => c.status !== 'disconnected').length ? (conns?.connections ?? []).filter((c: any) => c.status !== 'disconnected').map((c: any) => (
      <View key={c.id} style={st.item}><View style={st.itemIc}><Text style={{ fontSize: 18 }}>🔌</Text></View>
        <View style={{ flex: 1 }}><Text style={st.itemT}>{c.provider}</Text><Text style={st.itemS}>{c.status}</Text></View>
        {c.status === 'paused'
          ? <TouchableOpacity style={st.smBtn} disabled={!!busy} onPress={() => resume(c.id)}><Text style={st.smBtnTxt}>{busy === c.id ? '…' : 'Resume'}</Text></TouchableOpacity>
          : <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity style={st.smBtn} disabled={!!busy} onPress={() => sync(c.id)}><Text style={st.smBtnTxt}>{busy === c.id ? '…' : 'Sync'}</Text></TouchableOpacity>
              <TouchableOpacity style={[st.smBtn, { backgroundColor: C.surf2 }]} disabled={!!busy} onPress={() => pause(c.id)}><Text style={[st.smBtnTxt, { color: C.soft }]}>Pause</Text></TouchableOpacity>
            </View>}
      </View>
    )) : <Card><Text style={st.muted}>No connections yet.</Text></Card>}
    {(det?.detected ?? []).length > 0 && <>
      <SectionTitle>Detected — confirm to add</SectionTitle>
      {(det?.detected ?? []).map((i: any) => (
        <View key={i.id} style={st.recCard}>
          <View style={st.recTop}><Text style={st.recIc}>{i.type === 'travel' ? '✈️' : i.type === 'purchase' ? '🧾' : '🔁'}</Text>
            <View style={{ flex: 1 }}><Text style={st.itemT} numberOfLines={1}>{i.rawSubject ?? i.type}</Text><Text style={st.itemS}>{i.type}</Text></View>
          </View>
          <View style={st.chipRow}>
            <TouchableOpacity style={[st.chip, st.chipOn]} onPress={() => add(i.id)}><Text style={st.chipTxtOn}>Add</Text></TouchableOpacity>
            <TouchableOpacity style={st.chip} onPress={() => dismiss(i.id)}><Text style={st.chipTxt}>Dismiss</Text></TouchableOpacity>
          </View>
        </View>
      ))}
    </>}
  </ScrollView>;
}

function MemberDocItem({ m, docs, onChange }: any) {
  const [data, reload] = useAsync(() => api.memberDocuments(m.id), [m.id]);
  const [open, setOpen] = useState(false);
  const linked = data?.documents ?? [];
  const assignable = (docs ?? []).filter((d: any) => d.subjectMemberId !== m.id);
  async function link(id: string) { await api.assignDocumentMember(id, m.id); await reload(); onChange?.(); }
  async function unlink(id: string) { await api.assignDocumentMember(id, null); await reload(); onChange?.(); }
  return <View style={st.recCard}>
    <TouchableOpacity style={st.recTop} activeOpacity={0.8} onPress={() => setOpen(!open)}>
      <Text style={st.recIc}>{m.isDependant ? '🧒' : '👤'}</Text>
      <View style={{ flex: 1 }}><Text style={st.itemT}>{m.name}</Text><Text style={st.itemS}>{m.relationship ?? 'Family member'} · {linked.length} document{linked.length === 1 ? '' : 's'}</Text></View>
      <Text style={st.chev}>{open ? '▾' : '▸'}</Text>
    </TouchableOpacity>
    {open && <View style={{ marginTop: 8 }}>
      {linked.map((d: any) => <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}><Text style={{ fontSize: 13 }}>📄 {d.title}</Text><TouchableOpacity onPress={() => unlink(d.id)}><Text style={{ color: C.brand, fontSize: 12.5 }}>Remove</Text></TouchableOpacity></View>)}
      {!linked.length && <Text style={st.itemS}>No documents linked yet.</Text>}
      {assignable.length > 0 && <View style={st.chipRow}>{assignable.slice(0, 6).map((d: any) => <TouchableOpacity key={d.id} style={st.chip} onPress={() => link(d.id)}><Text style={st.chipTxt} numberOfLines={1}>＋ {d.title}</Text></TouchableOpacity>)}</View>}
    </View>}
  </View>;
}
function Family({ me }: any) {
  const [members, rm] = useAsync(() => api.familyMembers());
  const [docsData, rd] = useAsync(() => api.documents());
  const [nok, rn] = useAsync(() => api.nok());
  const [mode, setMode] = useState<null | 'member' | 'nok'>(null);
  const [mf, setMf] = useState({ name: '', relationship: '', dateOfBirth: '' });
  const [nf, setNf] = useState({ name: '', email: '', relationship: '' });
  const [busy, setBusy] = useState(false);
  async function addMember() {
    if (!mf.name.trim()) { Alert.alert('Add a name'); return; }
    setBusy(true);
    try { await api.addMember({ ...mf, name: mf.name.trim() }); setMf({ name: '', relationship: '', dateOfBirth: '' }); setMode(null); await rm(); }
    catch (e) { Alert.alert('Could not add', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  async function nominate() {
    if (!nf.name.trim() || !/^[^@]+@[^@]+$/.test(nf.email)) { Alert.alert('Add a name and a valid email'); return; }
    setBusy(true);
    try { await api.nominateNok({ ...nf, name: nf.name.trim() }); setNf({ name: '', email: '', relationship: '' }); setMode(null); await rn(); }
    catch (e) { Alert.alert('Could not nominate', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  async function invite(id: string) { try { await api.inviteNok(id); await rn(); Alert.alert('Invite sent', 'Your next of kin has been invited.'); } catch { Alert.alert('Try again'); } }
  if (!members || !nok) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={st.spread}><Text style={st.section}>Family members</Text><AddToggle open={mode === 'member'} onToggle={() => setMode(mode === 'member' ? null : 'member')} /></View>
    {mode === 'member' && <Card>
      <Field label="Name" value={mf.name} onChangeText={(v: string) => setMf({ ...mf, name: v })} placeholder="Sam Morgan" />
      <Field label="Relationship" value={mf.relationship} onChangeText={(v: string) => setMf({ ...mf, relationship: v })} placeholder="Child / Partner" />
      <Field label="Date of birth (YYYY-MM-DD)" value={mf.dateOfBirth} onChangeText={(v: string) => setMf({ ...mf, dateOfBirth: v })} placeholder="2015-06-01" />
      <Btn label="Add member" busy={busy} onPress={addMember} />
    </Card>}
    {(members.members ?? []).length ? (members.members ?? []).map((m: any) => (
      <MemberDocItem key={m.id} m={m} docs={docsData?.documents ?? []} onChange={rd} />
    )) : <Card><Text style={st.muted}>No family members added yet.</Text></Card>}

    <View style={st.spread}><Text style={st.section}>Next of kin</Text><AddToggle open={mode === 'nok'} onToggle={() => setMode(mode === 'nok' ? null : 'nok')} /></View>
    {mode === 'nok' && <Card>
      <Field label="Name" value={nf.name} onChangeText={(v: string) => setNf({ ...nf, name: v })} placeholder="Jordan Morgan" />
      <Field label="Email" value={nf.email} onChangeText={(v: string) => setNf({ ...nf, email: v })} autoCapitalize="none" keyboardType="email-address" placeholder="jordan@example.com" />
      <Field label="Relationship" value={nf.relationship} onChangeText={(v: string) => setNf({ ...nf, relationship: v })} placeholder="Sibling" />
      <Btn label="Nominate" busy={busy} onPress={nominate} />
    </Card>}
    {(nok.nextOfKin ?? []).length ? (nok.nextOfKin ?? []).map((n: any) => (
      <View key={n.id} style={st.item}><View style={st.itemIc}><Text style={{ fontSize: 18 }}>🤝</Text></View>
        <View style={{ flex: 1 }}><Text style={st.itemT}>{n.name}</Text><Text style={st.itemS}>{n.email} · {n.status}</Text></View>
        {n.status !== 'confirmed' && <TouchableOpacity style={st.smBtn} onPress={() => invite(n.id)}><Text style={st.smBtnTxt}>Invite</Text></TouchableOpacity>}
      </View>
    )) : <Card><Text style={st.muted}>Nominate a trusted person who can reach your vault in an emergency.</Text></Card>}
  </ScrollView>;
}

function Emergency() {
  const [status] = useAsync(() => api.emergencyStatus());
  const [reqs, reload] = useAsync(() => api.emergencyRequests().catch(() => ({ requests: [] })));
  async function decide(id: string, decision: 'approve' | 'decline') {
    try { await api.emergencyOwnerDecision(id, { decision }); await reload(); } catch (e) { Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Try again'); }
  }
  async function revoke(id: string) { try { await api.emergencyRevoke(id); await reload(); } catch { Alert.alert('Try again'); } }
  if (!status) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={[st.okBox, { backgroundColor: status.enabled ? C.goodBg : C.warnBg }]}>
      <Text style={{ color: status.enabled ? C.good : C.warn, fontWeight: '600', fontSize: 13.5 }}>{status.enabled ? '🛡️ ' : '⏳ '}{status.message}</Text>
    </View>
    <Text style={st.muted}>If your next of kin ever requests access to your vault, it appears here for your approval. Nothing is shared without you saying yes.</Text>
    <SectionTitle>Access requests</SectionTitle>
    {(reqs?.requests ?? []).length ? (reqs?.requests ?? []).map((r: any) => (
      <View key={r.id} style={st.recCard}>
        <View style={st.recTop}><Text style={st.recIc}>🛡️</Text>
          <View style={{ flex: 1 }}><Text style={st.itemT}>{r.requesterName ?? r.requesterEmail ?? 'A next of kin'}</Text><Text style={st.itemS}>{r.status} · {fmt(r.createdAt)}</Text></View>
        </View>
        {r.status === 'pending_owner' || r.status === 'pending' ? <View style={st.chipRow}>
          <TouchableOpacity style={[st.chip, st.chipOn]} onPress={() => decide(r.id, 'approve')}><Text style={st.chipTxtOn}>Approve</Text></TouchableOpacity>
          <TouchableOpacity style={st.chip} onPress={() => decide(r.id, 'decline')}><Text style={st.chipTxt}>Decline</Text></TouchableOpacity>
        </View> : r.status === 'active' ? <View style={st.chipRow}><TouchableOpacity style={st.chip} onPress={() => revoke(r.id)}><Text style={st.chipTxt}>Revoke access</Text></TouchableOpacity></View> : null}
      </View>
    )) : <Card><Text style={st.muted}>No emergency-access requests. You're in control — this stays empty unless someone asks.</Text></Card>}
  </ScrollView>;
}

function Billing({ me }: any) {
  const [plans] = useAsync(() => api.plans());
  const [bill, reload] = useAsync(() => api.billing().catch(() => null));
  const [busy, setBusy] = useState('');
  const sub = bill?.subscription;
  const current = sub?.planKey ?? me.tenant?.plan ?? 'starter';
  const hasPaid = sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  const currentAmount = (plans?.plans ?? []).find((x: any) => x.key === current)?.amount ?? 0;

  async function choose(key: string) {
    setBusy(key);
    try {
      if (hasPaid) { const r = await api.changePlan(key); Alert.alert('Plan changed', `${r.direction === 'downgrade' ? 'Downgraded' : 'Upgraded'} to ${key}.`); await reload(); }
      else { const s = await api.checkout(key); Alert.alert('Checkout', s?.url ? 'Continue in your browser to complete payment.' : 'Checkout started.'); }
    } catch (e) { Alert.alert('Could not change plan', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(''); }
  }
  async function cancel() {
    Alert.alert('Cancel renewal', 'You keep full access until the end of your current period.', [
      { text: 'Keep plan', style: 'cancel' },
      { text: 'Cancel renewal', style: 'destructive', onPress: async () => { setBusy('cancel'); try { await api.cancelSubscription(); await reload(); } catch (e) { Alert.alert('Failed', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); } } },
    ]);
  }
  async function resume() { setBusy('resume'); try { await api.resumeSubscription(); await reload(); } catch (e) { Alert.alert('Failed', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); } }
  if (!plans) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={st.planCard}><Text style={st.planLab}>CURRENT PLAN</Text><Text style={st.planName}>{current}</Text>
      {sub?.status && <Text style={{ color: '#fff', opacity: 0.85, fontSize: 12.5, marginTop: 2, textTransform: 'capitalize' }}>{sub.status}{sub.cancelAtPeriodEnd ? ' · ends at period end' : ''}{sub.currentPeriodEnd ? ` · ${sub.cancelAtPeriodEnd ? 'until' : 'renews'} ${fmt(sub.currentPeriodEnd)}` : ''}</Text>}
    </View>
    {hasPaid && <View style={{ marginBottom: 4 }}>
      {sub.cancelAtPeriodEnd
        ? <Btn label={busy === 'resume' ? 'Resuming…' : 'Resume renewal'} onPress={resume} busy={busy === 'resume'} />
        : <Btn label={busy === 'cancel' ? 'Cancelling…' : 'Cancel renewal'} secondary onPress={cancel} busy={busy === 'cancel'} />}
    </View>}
    <SectionTitle>Plans</SectionTitle>
    {(plans.plans ?? []).map((p: any) => {
      const isCurrent = current === p.key;
      const isDown = hasPaid && p.amount > 0 && p.amount < currentAmount;
      return <View key={p.key} style={st.recCard}>
        <View style={st.recTop}><Text style={st.recIc}>💳</Text>
          <View style={{ flex: 1 }}><Text style={st.itemT}>{p.name}</Text><Text style={st.itemS}>{p.amount ? `${(p.currency ?? 'GBP').toUpperCase()} ${(Number(p.amount) / 100).toFixed(2)}/${p.interval ?? 'yr'}` : 'Free'}</Text></View>
          {isCurrent ? <Text style={[st.tag, { backgroundColor: C.goodBg, color: C.good }]}>current</Text>
            : p.amount > 0 ? <TouchableOpacity style={st.smBtn} disabled={!!busy} onPress={() => choose(p.key)}><Text style={st.smBtnTxt}>{busy === p.key ? '…' : hasPaid ? (isDown ? 'Downgrade' : 'Upgrade') : 'Choose'}</Text></TouchableOpacity> : null}
        </View>
      </View>;
    })}
    {(bill?.invoices ?? []).length > 0 && <>
      <SectionTitle>Invoices</SectionTitle>
      {(bill?.invoices ?? []).map((iv: any) => <Item key={iv.id} icon="🧾" t={iv.number ?? 'Invoice'} sub={`${iv.status ?? ''} · ${fmt(iv.createdAt)}`} />)}
    </>}
  </ScrollView>;
}

function Support() {
  const [data, reload] = useAsync(() => api.supportTickets());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<any>(null);
  async function create() {
    if (!f.subject.trim() || !f.body.trim()) { Alert.alert('Add a subject and a message'); return; }
    setBusy(true);
    try { await api.createSupportTicket({ subject: f.subject.trim(), body: f.body.trim() }); setF({ subject: '', body: '' }); setOpen(false); await reload(); }
    catch (e) { Alert.alert('Could not send', e instanceof ApiError ? e.message : 'Try again'); } finally { setBusy(false); }
  }
  if (active) return <TicketThread id={active} onBack={() => { setActive(null); reload(); }} />;
  if (!data) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <View style={st.spread}><Text style={st.section}>Your requests</Text><AddToggle open={open} onToggle={() => setOpen(!open)} /></View>
    {open && <Card>
      <Field label="Subject" value={f.subject} onChangeText={(v: string) => setF({ ...f, subject: v })} placeholder="I can't add a document" />
      <Field label="Message" value={f.body} onChangeText={(v: string) => setF({ ...f, body: v })} multiline placeholder="Describe what's happening…" />
      <Btn label="Send request" busy={busy} onPress={create} />
    </Card>}
    {(data.tickets ?? []).length ? (data.tickets ?? []).map((t: any) => (
      <TouchableOpacity key={t.id} onPress={() => setActive(t.id)} activeOpacity={0.8}>
        <Item icon="💬" t={t.subject} sub={`${t.status}${t.messageCount ? ` · ${t.messageCount} messages` : ''}`} right={<Text style={st.chev}>›</Text>} />
      </TouchableOpacity>
    )) : <Card><Text style={st.muted}>No requests yet. Tap + Add if you need help.</Text></Card>}
  </ScrollView>;
}
function TicketThread({ id, onBack }: any) {
  const [data, reload] = useAsync(() => api.supportTicket(id));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!msg.trim()) return;
    setBusy(true);
    try { await api.supportReply(id, msg.trim()); setMsg(''); await reload(); } catch { Alert.alert('Try again'); } finally { setBusy(false); }
  }
  if (!data) return <Loading />;
  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={st.pad}>
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 8 }}><Text style={st.link}>‹ All requests</Text></TouchableOpacity>
      <Text style={st.section}>{data.ticket?.subject}</Text>
      {(data.messages ?? []).map((m: any) => (
        <View key={m.id} style={[st.bubble, m.authorType === 'agent' || m.fromAgent ? st.bubbleAi : st.bubbleMe, { alignSelf: (m.authorType === 'agent' || m.fromAgent) ? 'flex-start' : 'flex-end', marginBottom: 8, maxWidth: '86%' }]}>
          <Text style={(m.authorType === 'agent' || m.fromAgent) ? { color: C.ink } : { color: '#fff' }}>{m.body}</Text>
        </View>
      ))}
    </ScrollView>
    <View style={st.composer}>
      <TextInput style={st.composerInput} value={msg} onChangeText={setMsg} placeholder="Reply…" placeholderTextColor={C.soft} />
      <TouchableOpacity style={st.sendBtn} disabled={busy} onPress={send}><Text style={{ color: '#fff', fontWeight: '700' }}>Send</Text></TouchableOpacity>
    </View>
  </View>;
}

function FaqScreen() {
  const [data] = useAsync(() => api.faq());
  const [open, setOpen] = useState('');
  if (!data) return <Loading />;
  const support = data.support;
  return <ScrollView contentContainerStyle={st.pad}>
    {support && <Card>
      <Text style={st.cardT}>Getting help</Text>
      <Text style={st.muted}>{support.intro}</Text>
      {(support.channels ?? []).map((c: any, i: number) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <Text style={{ fontSize: 18 }}>{c.icon}</Text>
          <View style={{ flex: 1 }}><Text style={st.itemT}>{c.title}</Text><Text style={st.itemS}>{c.detail}</Text></View>
        </View>
      ))}
      <Text style={[st.itemS, { marginTop: 10 }]}>{support.responseTime}</Text>
    </Card>}
    {(data.categories ?? []).map((cat: any) => <View key={cat.key}>
      <SectionTitle>{cat.title}</SectionTitle>
      {cat.items.map((it: any, i: number) => {
        const id = `${cat.key}-${i}`; const isOpen = open === id;
        return <TouchableOpacity key={id} style={st.recCard} activeOpacity={0.8} onPress={() => setOpen(isOpen ? '' : id)}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={[st.itemT, { flex: 1 }]}>{it.q}</Text><Text style={st.chev}>{isOpen ? '▾' : '▸'}</Text></View>
          {isOpen && <Text style={[st.muted, { marginTop: 8 }]}>{it.a}</Text>}
        </TouchableOpacity>;
      })}
    </View>)}
  </ScrollView>;
}

function HelpCentre() {
  const [data] = useAsync(() => api.helpArticles());
  const [active, setActive] = useState<any>(null);
  if (active) return <ScrollView contentContainerStyle={st.pad}>
    <TouchableOpacity onPress={() => setActive(null)} style={{ marginBottom: 8 }}><Text style={st.link}>‹ All articles</Text></TouchableOpacity>
    <Text style={st.section}>{active.title}</Text>
    <Text style={[st.muted, { lineHeight: 21 }]}>{active.body ?? active.excerpt}</Text>
  </ScrollView>;
  if (!data) return <Loading />;
  return <ScrollView contentContainerStyle={st.pad}>
    <Text style={st.muted}>Guides and answers to common questions.</Text>
    <View style={{ height: 8 }} />
    {(data.articles ?? []).length ? (data.articles ?? []).map((a: any) => (
      <TouchableOpacity key={a.id} onPress={() => setActive(a)} activeOpacity={0.8}>
        <Item icon="📘" t={a.title} sub={a.category ?? a.excerpt ?? ''} right={<Text style={st.chev}>›</Text>} />
      </TouchableOpacity>
    )) : <Card><Text style={st.muted}>No help articles yet.</Text></Card>}
  </ScrollView>;
}

function Settings({ me, refreshMe }: any) {
  const [ns, setNs] = useState<any>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [enroll, setEnroll] = useState<any>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [bioCap, setBioCap] = useState<BiometricCapability | null>(null);
  const [bioOn, setBioOn] = useState(false);
  useEffect(() => { api.notifSettings().then(setNs).catch(() => {}); api.sessions().then((r) => setSessions(r.sessions ?? [])).catch(() => {}); }, []);
  useEffect(() => { (async () => { setBioCap(await getCapability()); setBioOn(await isBiometricEnabled()); })(); }, []);
  async function toggleBiometric(next: boolean) {
    if (next) {
      const r = await authenticate(`Enable ${bioCap?.label ?? 'biometric unlock'}`);
      if (!r.success) { Alert.alert('Not enabled', 'We couldn’t confirm your biometrics. Please try again.'); return; }
    }
    await setBiometricEnabled(next); setBioOn(next);
  }
  async function saveNs(patch: any) { const next = { ...ns, ...patch }; setNs(next); try { await api.setNotifSettings(patch); } catch { Alert.alert('Could not save'); } }
  async function beginMfa() { setBusy('mfa'); try { setEnroll(await api.enrollMfa()); } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); } }
  async function confirmMfa() { setBusy('mfa'); try { await api.confirmMfa(code); setEnroll(null); setCode(''); await refreshMe(); Alert.alert('Two-factor enabled', 'Save your recovery codes from the web app.'); } catch (e) { Alert.alert('Invalid code', e instanceof ApiError ? e.message : ''); } finally { setBusy(''); } }
  async function disableMfa() {
    Alert.prompt?.('Disable 2FA', 'Enter a current authenticator code to turn off two-factor.', async (c?: string) => {
      if (!c) return; try { await api.disableMfa(c); await refreshMe(); } catch (e) { Alert.alert('Could not disable', e instanceof ApiError ? e.message : ''); }
    });
  }
  async function revokeOthers() { try { await api.revokeOtherSessions(); const r = await api.sessions(); setSessions(r.sessions ?? []); Alert.alert('Done', 'Other devices signed out.'); } catch { Alert.alert('Try again'); } }
  return <ScrollView contentContainerStyle={st.pad}>
    <SectionTitle>Two-factor authentication</SectionTitle>
    <Card>
      <View style={st.spread}><Text style={st.itemT}>Status</Text><Text style={[st.tag, me.mfaEnabled ? { backgroundColor: C.goodBg, color: C.good } : { backgroundColor: C.warnBg, color: C.warn }]}>{me.mfaEnabled ? 'Enabled' : 'Off'}</Text></View>
      {!me.mfaEnabled && !enroll && <Btn label="Enable 2FA" busy={busy === 'mfa'} onPress={beginMfa} />}
      {enroll && <>
        <Text style={[st.muted, { marginTop: 10 }]}>Add this key to your authenticator app, then enter the 6-digit code:</Text>
        <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 13, marginTop: 6 }}>{enroll.secret}</Text>
        <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="123456" />
        <Btn label="Verify & enable" busy={busy === 'mfa'} onPress={confirmMfa} />
      </>}
      {me.mfaEnabled && Platform.OS === 'ios' && <Btn label="Disable 2FA" secondary onPress={disableMfa} />}
    </Card>

    <SectionTitle>App lock</SectionTitle>
    <Card>
      {bioCap?.available ? (
        <>
          <Toggle label={`Unlock with ${bioCap.label}`} value={bioOn} onChange={toggleBiometric} last />
          <Text style={[st.muted, { marginTop: 8 }]}>Require {bioCap.label} to open Vaulmo on this device. Your sign-in stays saved securely; {bioCap.label} just confirms it’s you.</Text>
        </>
      ) : (
        <Text style={st.muted}>{bioCap && bioCap.hasHardware && !bioCap.enrolled
          ? 'Set up Face ID or a fingerprint in your device settings to enable app lock here.'
          : 'This device doesn’t support biometric unlock.'}</Text>
      )}
    </Card>

    {ns && <>
      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <Toggle label="In-app alerts" value={ns.inApp} onChange={(v: boolean) => saveNs({ inApp: v })} />
        <Toggle label="Email" value={ns.email} onChange={(v: boolean) => saveNs({ email: v })} />
        <Toggle label="Push" value={ns.push} onChange={(v: boolean) => saveNs({ push: v })} last />
      </Card>
      <SectionTitle>Quiet hours</SectionTitle>
      <Card>
        <Text style={st.muted}>Hold non-urgent alerts during these hours (24h). Overdue items still come through.</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}><Field label="From" value={ns.quietStart == null ? '' : String(ns.quietStart)} onChangeText={(v: string) => saveNs({ quietStart: v === '' ? null : Math.max(0, Math.min(23, parseInt(v) || 0)) })} keyboardType="number-pad" placeholder="22" /></View>
          <View style={{ flex: 1 }}><Field label="To" value={ns.quietEnd == null ? '' : String(ns.quietEnd)} onChangeText={(v: string) => saveNs({ quietEnd: v === '' ? null : Math.max(0, Math.min(23, parseInt(v) || 0)) })} keyboardType="number-pad" placeholder="7" /></View>
        </View>
      </Card>
    </>}

    <SectionTitle>Signed-in devices</SectionTitle>
    {sessions.length ? sessions.map((sn: any) => (
      <Item key={sn.id} icon="📱" t={sn.userAgent ? String(sn.userAgent).slice(0, 28) : 'Device'} sub={`${sn.current ? 'This device · ' : ''}${fmt(sn.createdAt)}`} />
    )) : <Card><Text style={st.muted}>Just this device.</Text></Card>}
    {sessions.length > 1 && <Btn label="Sign out other devices" secondary onPress={revokeOthers} />}
  </ScrollView>;
}
const FUELS = ['petrol', 'diesel', 'hybrid', 'electric'];
function zoneTypeLabel(t: string) { return ({ ulez: 'ULEZ', caz: 'Clean Air Zone', lez: 'Low-emission zone', congestion: 'Congestion charge', toll: 'Toll', noparking: 'No parking' } as any)[t] || t; }
function zoneCostLabel(z: any) {
  const per = z.unit === 'day' ? '/day' : '/trip';
  if (z.type === 'noparking') return z.schedule?.start ? `no parking ${z.schedule.start}–${z.schedule.end}` : 'no parking';
  if (z.type === 'toll') return `${money(z.amount, z.currency)}${per}`;
  if (z.compliantFree) return `${money(z.amount, z.currency)}${per} if not compliant`;
  return `${money(z.amount, z.currency)}${per}`;
}
function DrivingCharges() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vehicles, reloadVehicles] = useAsync(() => api.drivingVehicles());
  const [zonesData] = useAsync(() => api.drivingZones());
  const [alertsData] = useAsync(() => api.drivingAlerts());
  useEffect(() => { isDrivingEnabled().then(setEnabled).catch(() => {}); }, []);

  async function toggle(v: boolean) {
    setBusy(true);
    try {
      if (v) {
        const r = await enableDrivingAlerts();
        if (!r.ok) { setEnabled(false); Alert.alert('Couldn’t turn on alerts', r.reason || 'Please allow location access in Settings.'); }
        else { setEnabled(true); Alert.alert('Driving alerts on', 'We’ll warn you about the likely cost the moment you drive into a charge zone — even if the app is closed.'); }
      } else { await disableDrivingAlerts(); setEnabled(false); }
    } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function saveVehicle(v: any, patch: any) {
    try { await api.setDrivingVehicle(v.id, patch); reloadVehicles(); refreshDrivingData().catch(() => {}); } catch (e) { Alert.alert('Error', e instanceof ApiError ? e.message : ''); }
  }

  const [parking, setParking] = useState<any[] | null>(null);
  const [pbusy, setPbusy] = useState(false);
  async function findParking() {
    setPbusy(true);
    try {
      const { lat, lng } = await currentLatLng();
      if (lat == null || lng == null) { await openParkingSearch(); return; }
      const list = await nearbyParking(lat, lng);
      setParking(list);
      if (!list.length) await openParkingSearch(lat, lng);
    } catch { await openParkingSearch(); } finally { setPbusy(false); }
  }

  const vs = vehicles?.vehicles ?? [];
  const zones = zonesData?.zones ?? [];
  const alerts = alertsData?.alerts ?? [];
  if (!vehicles) return <Loading />;

  return <ScrollView contentContainerStyle={st.pad}>
    <Card>
      {busy ? <ActivityIndicator color={C.brand} /> : <Toggle label="Driving charge alerts" value={enabled} onChange={toggle} last />}
      <Text style={[st.muted, { marginTop: 8 }]}>Get a heads-up about the likely cost the moment you drive into a ULEZ, Clean Air Zone, congestion charge, low-emission zone or toll — based on your car’s details. Works in the background, even when the app is closed.</Text>
    </Card>

    <SectionTitle>Your vehicles</SectionTitle>
    <Card>
      {vs.length ? vs.map((v: any, i: number) => <View key={v.id} style={[st.detailRow, i === vs.length - 1 && { borderBottomWidth: 0 }, { flexDirection: 'column', alignItems: 'stretch' }]}>
        <Text style={st.itemT}>{v.name}{v.registration ? ` · ${v.registration}` : ''}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {FUELS.map((f) => <TouchableOpacity key={f} onPress={() => saveVehicle(v, { fuelType: f })} style={[st.chip, v.fuelType === f && st.chipOn]}><Text style={[st.chipTxt, v.fuelType === f && { color: '#fff' }]}>{f}</Text></TouchableOpacity>)}
        </View>
        <TouchableOpacity onPress={() => saveVehicle(v, { compliant: !(v.compliant === true) })} style={[st.detailRow, { marginTop: 8, borderBottomWidth: 0, paddingVertical: 6 }]} accessibilityRole="switch" accessibilityState={{ checked: v.compliant === true }}>
          <Text style={[st.itemT, { flex: 1 }]}>Meets ULEZ/CAZ/LEZ standards</Text>
          <View style={[st.switch, v.compliant === true && { backgroundColor: C.good, alignItems: 'flex-end' }]}><View style={st.switchKnob} /></View>
        </TouchableOpacity>
        <Text style={st.muted}>{v.compliant === true ? 'We won’t warn you in emission zones (you’re exempt) — you’ll still be alerted for congestion charges and tolls.' : v.compliant === false ? 'We’ll warn you about the daily charge in emission zones.' : 'Set this so we can tell you whether a charge applies. Not sure? Check your V5C or your city’s checker.'}</Text>
      </View>) : <Text style={st.muted}>Add a vehicle under Property &amp; Vehicles first, then set its details here.</Text>}
    </Card>

    <SectionTitle>Find parking</SectionTitle>
    <Card>
      <Text style={[st.muted, { marginTop: 0 }]}>Look for parking nearby — free spots are flagged where we can tell.</Text>
      <Btn label="Find parking near me" busy={pbusy} busyLabel="Searching…" onPress={findParking} />
      {parking && parking.length > 0 && parking.map((p: any, i: number) => <TouchableOpacity key={i} style={[st.detailRow, i === parking.length - 1 && { borderBottomWidth: 0 }]} onPress={() => openParkingSearch(p.lat, p.lng)}>
        <View style={{ flex: 1 }}><Text style={st.itemT}>{p.name}</Text><Text style={st.muted}>{p.distanceKm} km away · tap to open in Maps</Text></View>
        <Text style={[st.tag, p.free ? { backgroundColor: C.goodBg, color: C.good } : { backgroundColor: C.surf2, color: C.soft }]}>{p.free ? 'Free' : 'Paid?'}</Text>
      </TouchableOpacity>)}
      {parking && parking.length === 0 && <Text style={[st.muted, { marginTop: 8 }]}>Opened your maps app to search for parking nearby.</Text>}
    </Card>

    <SectionTitle>Zones we watch for</SectionTitle>
    <Card>
      {zones.slice(0, 40).map((z: any, i: number) => <View key={z.key} style={[st.detailRow, i === Math.min(zones.length, 40) - 1 && { borderBottomWidth: 0 }]}>
        <View style={{ flex: 1 }}><Text style={st.itemT}>{z.name}</Text><Text style={st.muted}>{z.country} · {zoneTypeLabel(z.type)}</Text></View>
        <Text style={[st.tag, { backgroundColor: C.brandSoft, color: C.brand }]}>{zoneCostLabel(z)}</Text>
      </View>)}
      <Text style={[st.muted, { marginTop: 8 }]}>Charges and boundaries are indicative and can change. Zone areas are approximate — always check the official signs and pay any charge that applies.</Text>
    </Card>

    {alerts.length > 0 && <>
      <SectionTitle>Recent alerts</SectionTitle>
      <Card>
        {alerts.slice(0, 15).map((a: any, i: number) => <View key={a.id} style={[st.detailRow, i === Math.min(alerts.length, 15) - 1 && { borderBottomWidth: 0 }]}>
          <View style={{ flex: 1 }}><Text style={st.itemT}>{a.zoneName}</Text><Text style={st.muted}>{a.vehicleLabel || ''}{a.at ? ` · ${new Date(a.at).toLocaleDateString()}` : ''}</Text></View>
          <Text style={[st.tag, { backgroundColor: C.warnBg, color: C.warn }]}>{money(a.amount, a.currency)}</Text>
        </View>)}
      </Card>
    </>}
  </ScrollView>;
}

function Toggle({ label, value, onChange, last }: any) {
  return <TouchableOpacity style={[st.detailRow, last && { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => onChange(!value)}
    accessibilityRole="switch" accessibilityLabel={typeof label === 'string' ? label : undefined} accessibilityState={{ checked: !!value }}>
    <Text style={st.itemT}>{label}</Text>
    <View style={[st.switch, value && { backgroundColor: C.brand, alignItems: 'flex-end' }]}><View style={st.switchKnob} /></View>
  </TouchableOpacity>;
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
    <TouchableOpacity style={[st.btn, secondary && st.btnSec, off && { opacity: 0.6 }]} onPress={onPress} disabled={off} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={typeof label === 'string' ? label : undefined} accessibilityState={{ disabled: !!off, busy: !!busy }}>
      {busy ? <ActivityIndicator color={secondary ? C.brand : '#fff'} /> : <Text style={[st.btnTxt, secondary && { color: C.brand }]}>{busyLabel && busy ? busyLabel : label}</Text>}
    </TouchableOpacity>
  );
}
function Field({ label, multiline, ...rest }: any) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TextInput style={[st.input, multiline && { height: 120, textAlignVertical: 'top' }]} placeholderTextColor={C.soft} multiline={multiline} accessibilityLabel={typeof label === 'string' ? label : undefined} {...rest} />
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
  pageRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 10, marginTop: 10, borderWidth: 1, borderColor: C.line },
  pageThumb: { width: 56, height: 74, borderRadius: 8, backgroundColor: C.surf2 },
  ppImg: { width: '100%', aspectRatio: 35 / 45, borderRadius: 12, backgroundColor: C.surf2, marginTop: 6 },

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
  switch: { width: 46, height: 28, borderRadius: 16, backgroundColor: C.line, padding: 3, justifyContent: 'center' },
  switchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
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
