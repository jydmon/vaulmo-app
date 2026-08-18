// Vaulmo API client — covers the full surface used by the web app.
const BASE = import.meta.env.VITE_API_URL ?? '';

let accessToken: string | null = null;
let refreshToken: string | null = null;
export function setTokens(a: string | null, r: string | null) { accessToken = a; refreshToken = r; }
export function getAccessToken() { return accessToken; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && refreshToken) {
    if (await tryRefresh()) return request<T>(method, path, body, false);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'error', json?.message ?? 'Request failed');
  return json as T;
}
async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
    if (!res.ok) return false;
    const j = await res.json(); setTokens(j.accessToken, j.refreshToken); return true;
  } catch { return false; }
}

export interface AuthResult {
  user?: { id: string; email: string; fullName: string; tenantId: string | null; mfaEnabled: boolean };
  accessToken?: string; refreshToken?: string; mfaRequired?: boolean; challengeToken?: string;
}

export async function uploadText(url: string, text: string): Promise<void> {
  await fetch(`${BASE}${url}`, { method: 'PUT', headers: { 'content-type': 'text/plain', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: text });
}

const G = <T,>(p: string) => request<T>('GET', p);
const P = <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});

export const api = {
  // auth
  register: (b: any) => P<AuthResult>('/auth/register', b),
  login: (b: any) => P<AuthResult>('/auth/login', b),
  loginMfa: (code: string, challengeToken: string) => { accessToken = challengeToken; return request<AuthResult>('POST', '/auth/login/mfa', { code }, false); },
  me: () => G<any>('/users/me'),
  // vault
  checklist: () => G<any>('/vault/checklist'),
  documents: () => G<any>('/vault/documents'),
  createDocument: (b: any) => P<any>('/vault/documents', b),
  processDocument: (id: string) => P<any>(`/vault/documents/${id}/process`),
  confirmDocument: (id: string, metadata?: any) => P<any>(`/vault/documents/${id}/confirm`, { metadata }),
  reminders: () => G<any>('/vault/reminders'),
  // assistant
  ask: (question: string) => P<any>('/assistant/ask', { question }),
  search: (query: string) => P<any>('/assistant/search', { query }),
  whatsImportant: () => G<any>('/assistant/whats-important'),
  // notifications
  notifications: () => G<any>('/notifications'),
  unread: () => G<any>('/notifications/unread-count'),
  markRead: (id: string) => P<any>(`/notifications/${id}/read`),
  readAll: () => P<any>('/notifications/read-all'),
  // family
  familyMembers: () => G<any>('/family/members'),
  addMember: (b: any) => P<any>('/family/members', b),
  nok: () => G<any>('/family/nok'),
  nominateNok: (b: any) => P<any>('/family/nok', b),
  inviteNok: (id: string) => P<any>(`/family/nok/${id}/invite`),
  emergencyStatus: () => G<any>('/emergency/status'),
  // integrations
  providers: () => G<any>('/integrations/providers'),
  connectProvider: (p: string) => P<any>(`/integrations/${p}/connect`),
  callbackProvider: (p: string, code: string) => P<any>(`/integrations/${p}/callback`, { code }),
  connections: () => G<any>('/integrations/connections'),
  sync: (id: string) => P<any>(`/integrations/connections/${id}/sync`),
  detected: (status = 'pending') => G<any>(`/integrations/detected?status=${status}`),
  dismissDetected: (id: string) => P<any>(`/integrations/detected/${id}/dismiss`),
  confirmDetected: (id: string) => P<any>(`/inbox/detected/${id}/confirm`),
  // life
  trips: () => G<any>('/trips'),
  purchases: () => G<any>('/purchases'),
  trackedSubscriptions: () => G<any>('/tracked-subscriptions'),
  // billing
  plans: () => G<any>('/billing/plans'),
  billing: () => G<any>('/billing'),
  entitlements: () => G<any>('/billing/entitlements'),
  checkout: (planKey: string) => P<any>('/billing/checkout', { planKey }),
  // security / settings
  enrollMfa: () => P<any>('/mfa/enroll'),
  confirmMfa: (code: string) => P<any>('/mfa/confirm', { code }),
  disableMfa: (code: string) => P<any>('/mfa/disable', { code }),
  notifSettings: () => G<any>('/notifications/settings'),
  setNotifSettings: (b: any) => request<any>('PUT', '/notifications/settings', b),
  requestVerification: () => P<any>('/auth/request-verification'),
  verifyEmail: (token: string) => P<any>('/auth/verify-email', { token }),
  // sessions / devices
  sessions: () => G<any>('/auth/sessions'),
  revokeSession: (id: string) => P<any>(`/auth/sessions/${id}/revoke`),
  revokeOtherSessions: () => P<any>('/auth/sessions/revoke-others'),
  // open banking
  connectBank: () => P<any>('/integrations/bank/connect'),
  bankCallback: (code: string) => P<any>('/integrations/bank/callback', { code }),
  // admin
  adminTenants: () => G<any>('/admin/tenants'),
  adminUsers: () => G<any>('/admin/users'),
  adminAudit: () => G<any>('/admin/audit?limit=100'),
  adminMetrics: () => G<any>('/admin/metrics'),
  adminCustomers: () => G<any>('/admin/customers'),
  adminSubscriptions: () => G<any>('/admin/subscriptions'),
  adminSetSubscription: (tenantId: string, b: any) => P<any>(`/admin/subscriptions/${tenantId}`, b),
  adminBillingStatus: () => G<any>('/billing/admin/status'),
  adminPlansAll: () => G<any>('/billing/admin/plans'),
  adminUpsertPlan: (b: any) => P<any>('/billing/admin/plans', b),
  // support (customer)
  supportTickets: () => G<any>('/support/tickets'),
  createSupportTicket: (b: any) => P<any>('/support/tickets', b),
  supportTicket: (id: string) => G<any>(`/support/tickets/${id}`),
  supportReply: (id: string, body: string) => P<any>(`/support/tickets/${id}/messages`, { body }),
  // support (admin)
  adminSupportTickets: (status = '') => G<any>(`/admin/support/tickets${status ? `?status=${status}` : ''}`),
  adminSupportTicket: (id: string) => G<any>(`/admin/support/tickets/${id}`),
  adminSupportReply: (id: string, body: string) => P<any>(`/admin/support/tickets/${id}/messages`, { body }),
  adminSupportStatus: (id: string, status: string) => P<any>(`/admin/support/tickets/${id}/status`, { status }),
};
