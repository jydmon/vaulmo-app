import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';

// API base: EAS build profiles inject EXPO_PUBLIC_API_URL (inlined by Expo);
// falls back to app config, then localhost for a bare `expo start`.
const BASE: string =
  process.env.EXPO_PUBLIC_API_URL ??
  ((Constants.expoConfig?.extra as any)?.apiUrl as string) ??
  'http://localhost:4000';

let accessToken: string | null = null;
let refreshToken: string | null = null;

// SecureStore is native-only (iOS/Android). Guard every call so a web/preview
// build (where SecureStore is unavailable) falls back to in-memory tokens instead
// of throwing — device builds are unaffected and still use the secure keychain.
export async function loadTokens() {
  try {
    accessToken = await SecureStore.getItemAsync('access');
    refreshToken = await SecureStore.getItemAsync('refresh');
  } catch { /* no secure store (e.g. web) — tokens stay in memory */ }
}
export async function setTokens(a: string | null, r: string | null) {
  accessToken = a; refreshToken = r;
  try {
    if (a) await SecureStore.setItemAsync('access', a); else await SecureStore.deleteItemAsync('access');
    if (r) await SecureStore.setItemAsync('refresh', r); else await SecureStore.deleteItemAsync('refresh');
  } catch { /* no secure store (e.g. web) — tokens stay in memory */ }
}
export function hasToken() { return !!(accessToken || refreshToken); }

// Small persisted key/value flags (e.g. "the user dismissed the optional 2FA prompt").
export async function getFlag(k: string): Promise<string | null> { try { return await SecureStore.getItemAsync('flag_' + k); } catch { return null; } }
export async function setFlag(k: string, v: string) { try { await SecureStore.setItemAsync('flag_' + k, v); } catch { /* ignore */ } }

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
    if (!res.ok) return false;
    const j = await res.json();
    await setTokens(j.accessToken, j.refreshToken);
    return true;
  } catch { return false; }
}

async function req<T>(method: string, path: string, body?: unknown, bearer?: string, retry = true): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...((bearer ?? accessToken) ? { authorization: `Bearer ${bearer ?? accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !bearer && refreshToken) {
    if (await tryRefresh()) return req<T>(method, path, body, undefined, false);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? 'Request failed');
  return json as T;
}

// Upload the already-text body (synthetic documents / typed text).
export async function uploadText(url: string, text: string): Promise<void> {
  await fetch(`${BASE}${url}`, { method: 'PUT', headers: { 'content-type': 'text/plain', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: text });
}

// The on-device byte size of a local file URI (for the create-document step).
export async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
    return info.exists && typeof (info as any).size === 'number' ? (info as any).size : 0;
  } catch { return 0; }
}

// Upload a captured photo / picked image. `uri` is a local file:// URI from
// expo-image-picker / expo-image-manipulator. We use expo-file-system's native
// binary uploader (streams the file straight to the presigned PUT URL) — far more
// reliable in React Native than fetching a Blob and PUTting it.
export async function uploadImage(url: string, uri: string, contentType: string): Promise<void> {
  const res = await FileSystem.uploadAsync(`${BASE}${url}`, uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'content-type': contentType, ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
  });
  if (res.status < 200 || res.status >= 300) {
    let msg = 'Upload failed';
    try { const j = JSON.parse(res.body); msg = j?.message ?? msg; } catch { /* keep default */ }
    throw new ApiError(res.status, 'upload_failed', msg);
  }
}

// Send a captured photo to the passport processor and get back the compliant result
// (base64 preview + metadata). Uses the native binary uploader like image uploads.
export async function processPassport(uri: string, save = false): Promise<{ meta: any; preview: string; documentId: string | null }> {
  const res = await FileSystem.uploadAsync(`${BASE}/api/v1/passport/process${save ? '?save=1' : ''}`, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'content-type': 'image/jpeg', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
  });
  let j: any = {}; try { j = JSON.parse(res.body); } catch { /* keep {} */ }
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, j?.error ?? 'process_failed', j?.message ?? 'Could not process the photo');
  return j;
}

export interface AuthResult {
  user?: any; accessToken?: string; refreshToken?: string;
  mfaRequired?: boolean; challengeToken?: string; mfaSetupRequired?: boolean;
}

const G = <T,>(p: string) => req<T>('GET', p);
const P = <T,>(p: string, b?: unknown) => req<T>('POST', p, b ?? {});
const PUT = <T,>(p: string, b?: unknown) => req<T>('PUT', p, b ?? {});
const DEL = <T,>(p: string) => req<T>('DELETE', p);

export const api = {
  // auth
  register: (b: any) => P<AuthResult>('/auth/register', b),
  login: (b: any) => P<AuthResult>('/auth/login', b),
  loginMfa: (code: string, ct: string) => req<AuthResult>('POST', '/auth/login/mfa', { code }, ct),
  me: () => G<any>('/users/me'),
  updateProfile: (b: { fullName?: string; phone?: string | null; timezone?: string | null; country?: string }) => PUT<any>('/users/me', b),
  // onboarding flow
  legalDoc: (key: string) => G<any>(`/legal/${key}`),
  acceptTerms: () => P<any>('/users/me/accept-terms'),
  tourSeen: () => P<any>('/users/me/tour-seen'),
  choosePlan: (planKey: string) => P<any>('/billing/choose', { planKey }),
  faq: () => G<any>('/faq'),
  // vault
  catalogue: () => G<any>('/vault/catalogue'),
  editDocument: (id: string, b: { typeKey?: string; title?: string; metadata?: Record<string, string> }) => req<any>('PATCH', `/vault/documents/${id}`, b),
  checklist: () => G<any>('/vault/checklist'),
  onboarding: () => G<any>('/vault/onboarding'),
  saveOnboarding: (answers: Record<string, any>) => P<any>('/vault/onboarding', { answers }),
  checklistDecision: (typeKey: string, decision: string) => P<any>('/vault/checklist/decision', { typeKey, decision }),
  documents: () => G<any>('/vault/documents'),
  getDocument: (id: string) => G<any>(`/vault/documents/${id}`),
  createDocument: (b: any) => P<any>('/vault/documents', b),
  processDocument: (id: string) => P<any>(`/vault/documents/${id}/process`),
  confirmDocument: (id: string, metadata?: any) => P<any>(`/vault/documents/${id}/confirm`, { metadata }),
  deleteDocument: (id: string) => DEL<any>(`/vault/documents/${id}`),
  // assistant
  ask: (question: string) => P<any>('/assistant/ask', { question }),
  whatsImportant: () => G<any>('/assistant/whats-important'),
  // reminders / notifications
  registerDevice: (platform: string, token: string) => P<any>('/notifications/devices', { platform, token }),
  reminders: () => G<any>('/vault/reminders'),
  expiries: (withinDays = 365) => G<any>(`/vault/expiries?withinDays=${withinDays}`),
  // password vault
  passwords: () => G<any>('/passwords'),
  createPassword: (b: any) => P<any>('/passwords', b),
  revealPassword: (id: string) => P<any>(`/passwords/${id}/reveal`),
  deletePassword: (id: string) => DEL<any>(`/passwords/${id}`),
  reminderCentre: () => G<any>('/notifications/reminders'),
  createReminder: (b: { title: string; dueDate: string; recurrence?: string; kind?: string }) => P<any>('/notifications/reminders', b),
  completeReminder: (id: string) => P<any>(`/notifications/reminders/${id}/complete`),
  snoozeReminder: (id: string, days: number) => P<any>(`/notifications/reminders/${id}/snooze`, { days }),
  unread: () => G<any>('/notifications/unread-count'),
  // integrations
  providers: () => G<any>('/integrations/providers'),
  connections: () => G<any>('/integrations/connections'),
  connect: (p: string) => P<any>(`/integrations/${p}/connect`),
  callback: (p: string, code: string) => P<any>(`/integrations/${p}/callback`, { code }),
  sync: (id: string) => P<any>(`/integrations/connections/${id}/sync`),
  pauseConnection: (id: string) => P<any>(`/integrations/connections/${id}/pause`),
  resumeConnection: (id: string) => P<any>(`/integrations/connections/${id}/resume`),
  detected: (status = 'pending') => G<any>(`/integrations/detected?status=${status}`),
  dismissDetected: (id: string) => P<any>(`/integrations/detected/${id}/dismiss`),
  confirmDetected: (id: string) => P<any>(`/inbox/detected/${id}/confirm`),
  // life records
  trips: () => G<any>('/trips'),
  createTrip: (b: any) => P<any>('/trips', b),
  purchases: () => G<any>('/purchases'),
  createPurchase: (b: any) => P<any>('/purchases', b),
  trackedSubscriptions: () => G<any>('/tracked-subscriptions'),
  createSubscription: (b: any) => P<any>('/tracked-subscriptions', b),
  // assets (properties & vehicles)
  assets: (kind?: string) => G<any>(`/assets${kind ? `?kind=${kind}` : ''}`),
  asset: (id: string) => G<any>(`/assets/${id}`),
  createAsset: (b: { kind: string; name: string; details?: Record<string, any> }) => P<any>('/assets', b),
  updateAsset: (id: string, b: { name?: string; details?: Record<string, any> }) => req<any>('PATCH', `/assets/${id}`, b),
  deleteAsset: (id: string) => DEL<any>(`/assets/${id}`),
  // driving charge zones (mobile-only geolocation alerts)
  drivingZones: (lat?: number, lng?: number, limit?: number) => G<any>(`/driving/zones${lat != null && lng != null ? `?lat=${lat}&lng=${lng}${limit ? `&limit=${limit}` : ''}` : ''}`),
  drivingVehicles: () => G<any>('/driving/vehicles'),
  setDrivingVehicle: (id: string, b: { fuelType?: string; compliant?: boolean }) => req<any>('PATCH', `/driving/vehicles/${id}`, b),
  logDrivingAlert: (b: { zoneKey: string; zoneName: string; vehicleLabel?: string; amount: number; currency?: string }) => P<any>('/driving/alert', b),
  drivingAlerts: () => G<any>('/driving/alerts'),
  assignDocumentAsset: (id: string, assetId: string | null) => P<any>(`/vault/documents/${id}/asset`, { assetId }),
  assignDocumentMember: (id: string, memberId: string | null) => P<any>(`/vault/documents/${id}/subject`, { memberId }),
  memberDocuments: (memberId: string) => G<any>(`/family/members/${memberId}/documents`),
  // privacy & security centre
  securityActivity: () => G<any>('/users/me/security-activity'),
  privacy: () => G<any>('/users/me/privacy'),
  addConsent: (policy: string, version: string) => P<any>('/users/me/consent', { policy, version }),
  exportData: () => P<any>('/users/me/export', {}),
  requestDeletion: (password: string, reason?: string) => P<any>('/users/me/deletion-request', { password, reason }),
  // family
  familyMembers: () => G<any>('/family/members'),
  addMember: (b: any) => P<any>('/family/members', b),
  nok: () => G<any>('/family/nok'),
  nominateNok: (b: any) => P<any>('/family/nok', b),
  inviteNok: (id: string) => P<any>(`/family/nok/${id}/invite`),
  // emergency
  emergencyStatus: () => G<any>('/emergency/status'),
  emergencyRequests: () => G<any>('/emergency/requests'),
  emergencyOwnerDecision: (id: string, b: { decision: 'approve' | 'decline'; note?: string }) => P<any>(`/emergency/requests/${id}/owner-decision`, b),
  emergencyRevoke: (id: string) => P<any>(`/emergency/requests/${id}/revoke`),
  // billing
  plans: () => G<any>('/billing/plans'),
  billing: () => G<any>('/billing'),
  entitlements: () => G<any>('/billing/entitlements'),
  checkout: (planKey: string) => P<any>('/billing/checkout', { planKey }),
  cancelSubscription: () => P<any>('/billing/cancel', {}),
  resumeSubscription: () => P<any>('/billing/resume', {}),
  changePlan: (planKey: string) => P<any>('/billing/change-plan', { planKey }),
  // support
  supportTickets: () => G<any>('/support/tickets'),
  createSupportTicket: (b: any) => P<any>('/support/tickets', b),
  supportTicket: (id: string) => G<any>(`/support/tickets/${id}`),
  supportReply: (id: string, body: string) => P<any>(`/support/tickets/${id}/messages`, { body }),
  // help centre
  helpArticles: () => G<any>('/cms/articles'),
  helpArticle: (slug: string) => G<any>(`/cms/articles/${slug}`),
  // settings: notifications, MFA, sessions
  notifSettings: () => G<any>('/notifications/settings'),
  setNotifSettings: (b: any) => PUT<any>('/notifications/settings', b),
  enrollMfa: () => P<any>('/mfa/enroll'),
  confirmMfa: (code: string) => P<any>('/mfa/confirm', { code }),
  disableMfa: (code: string) => P<any>('/mfa/disable', { code }),
  sessions: () => G<any>('/auth/sessions'),
  revokeSession: (id: string) => P<any>(`/auth/sessions/${id}/revoke`),
  revokeOtherSessions: () => P<any>('/auth/sessions/revoke-others'),
  requestVerification: () => P<any>('/auth/request-verification'),
  verifyEmail: (token: string) => P<any>('/auth/verify-email', { token }),
};
