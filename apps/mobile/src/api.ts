import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

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
export function hasToken() { return !!accessToken; }

export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

async function req<T>(method: string, path: string, body?: unknown, bearer?: string): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...((bearer ?? accessToken) ? { authorization: `Bearer ${bearer ?? accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text(); const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? 'Request failed');
  return json as T;
}
export async function uploadText(url: string, text: string): Promise<void> {
  await fetch(`${BASE}${url}`, { method: 'PUT', headers: { 'content-type': 'text/plain', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: text });
}

export interface AuthResult { user?: any; accessToken?: string; refreshToken?: string; mfaRequired?: boolean; challengeToken?: string; }
const G = <T,>(p: string) => req<T>('GET', p);
const P = <T,>(p: string, b?: unknown) => req<T>('POST', p, b ?? {});

export const api = {
  register: (b: any) => P<AuthResult>('/auth/register', b),
  login: (b: any) => P<AuthResult>('/auth/login', b),
  loginMfa: (code: string, ct: string) => req<AuthResult>('POST', '/auth/login/mfa', { code }, ct),
  me: () => G<any>('/users/me'),
  checklist: () => G<any>('/vault/checklist'),
  whatsImportant: () => G<any>('/assistant/whats-important'),
  documents: () => G<any>('/vault/documents'),
  createDocument: (b: any) => P<any>('/vault/documents', b),
  processDocument: (id: string) => P<any>(`/vault/documents/${id}/process`),
  confirmDocument: (id: string, metadata?: any) => P<any>(`/vault/documents/${id}/confirm`, { metadata }),
  reminders: () => G<any>('/vault/reminders'),
  ask: (question: string) => P<any>('/assistant/ask', { question }),
  connections: () => G<any>('/integrations/connections'),
  connect: (p: string) => P<any>(`/integrations/${p}/connect`),
  callback: (p: string, code: string) => P<any>(`/integrations/${p}/callback`, { code }),
  sync: (id: string) => P<any>(`/integrations/connections/${id}/sync`),
  detected: () => G<any>('/integrations/detected'),
  confirmDetected: (id: string) => P<any>(`/inbox/detected/${id}/confirm`),
  nok: () => G<any>('/family/nok'),
  emergencyStatus: () => G<any>('/emergency/status'),
  entitlements: () => G<any>('/billing/entitlements'),
};
