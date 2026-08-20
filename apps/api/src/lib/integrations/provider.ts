// Integration provider framework (Phase 9). One interface; a mock/sandbox driver for
// dev + CI, and real Gmail/Outlook drivers wired to OAuth + the Gmail/Graph APIs in
// staging/prod. The framework (OAuth start/exchange, token storage, sync, provenance)
// is provider-agnostic — real providers only implement these methods.

export interface RawEmail {
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}
export interface Provider {
  key: string;
  scopes: string[];
  startAuth(tenantId: string, redirectUri: string): { authUrl: string; state: string };
  exchange(code: string): Promise<{ providerAccountId: string; accessToken: string; refreshToken: string; scopes: string[] }>;
  fetchEmails(accessToken: string): Promise<RawEmail[]>;
}

// Deterministic sample inbox used by the sandbox drivers (synthetic — no real mailboxes).
function sampleInbox(providerKey: string): RawEmail[] {
  return [
    { from: 'noreply@britishairways.com', subject: 'Your flight booking BA2490 confirmation — LHR to JFK', body: 'Booking reference: XZ12AB. Flight BA2490 departs London Heathrow (LHR) on 12 Sep 2026 to New York (JFK). Check-in opens 24h before.', receivedAt: '2026-08-01' },
    { from: 'reservations@hilton.com', subject: 'Hotel reservation confirmed — Hilton New York', body: 'Reservation 88231. Check-in 12 Sep 2026, check-out 16 Sep 2026. Hilton Midtown, New York.', receivedAt: '2026-08-01' },
    { from: 'orders@currys.co.uk', subject: 'Your order receipt #A5567 — Samsung TV', body: 'Thank you for your purchase. Order A5567. Samsung 55" TV. Total: £599.00. Purchased 03 Aug 2026. 2 year warranty included, expires 03 Aug 2028.', receivedAt: '2026-08-03' },
    { from: 'tickets@seetickets.com', subject: 'Your e-ticket for Coldplay at Wembley', body: 'Event: Coldplay. Venue: Wembley Stadium. Date: 20 Sep 2026. Seat: B12. Booking ref TK9932.', receivedAt: '2026-08-04' },
    { from: 'noreply@netflix.com', subject: 'Your Netflix membership', body: 'Your monthly payment of £10.99 was successful. Next billing date: 15 Sep 2026.', receivedAt: '2026-08-05' },
  ];
}

class SandboxProvider implements Provider {
  constructor(public key: string, public scopes: string[]) {}
  startAuth(tenantId: string, redirectUri: string) {
    const state = Buffer.from(`${this.key}:${tenantId}:${Date.now()}`).toString('base64url');
    // Real drivers return the provider's OAuth consent URL. Sandbox returns a marker.
    return { authUrl: `https://oauth.${this.key}.sandbox/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`, state };
  }
  async exchange(code: string) {
    return { providerAccountId: `${this.key}_acct_${code.slice(0, 6)}`, accessToken: `at_${this.key}_${code}`, refreshToken: `rt_${this.key}_${code}`, scopes: this.scopes };
  }
  async fetchEmails(): Promise<RawEmail[]> {
    return sampleInbox(this.key);
  }
}

// ---- Real OAuth drivers (activate when credentials are configured) ----
import { env } from '../../env';

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];
const OUTLOOK_SCOPES = ['Mail.Read', 'offline_access', 'openid', 'email'];

// Google (Gmail) — standard OAuth 2.0 authorization-code flow + Gmail REST API.
class GoogleProvider implements Provider {
  key = 'gmail';
  scopes = GMAIL_SCOPES;
  constructor(private clientId: string, private clientSecret: string) {}
  startAuth(tenantId: string, redirectUri: string) {
    const state = Buffer.from(`gmail:${tenantId}:${Date.now()}`).toString('base64url');
    const params = new URLSearchParams({
      client_id: this.clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: this.scopes.join(' '), access_type: 'offline', prompt: 'consent', state,
    });
    return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state };
  }
  async exchange(code: string) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: env.INTEGRATIONS_REDIRECT_URI, grant_type: 'authorization_code' }).toString(),
    });
    if (!res.ok) throw new Error(`google_token_exchange_failed: ${res.status}`);
    const j: any = await res.json();
    let email = 'gmail_account';
    try {
      const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${j.access_token}` } });
      if (prof.ok) email = ((await prof.json()) as any).emailAddress ?? email;
    } catch { /* profile is best-effort */ }
    return { providerAccountId: email, accessToken: j.access_token, refreshToken: j.refresh_token ?? '', scopes: this.scopes };
  }
  async fetchEmails(accessToken: string): Promise<RawEmail[]> {
    const list = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=newer_than:180d', { headers: { authorization: `Bearer ${accessToken}` } });
    if (!list.ok) throw new Error(`gmail_list_failed: ${list.status}`);
    const ids = (((await list.json()) as any).messages ?? []).map((m: any) => m.id);
    const out: RawEmail[] = [];
    for (const id of ids.slice(0, 20)) {
      const msg = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!msg.ok) continue;
      const m: any = await msg.json();
      const h = (name: string) => (m.payload?.headers ?? []).find((x: any) => x.name === name)?.value ?? '';
      out.push({ from: h('From'), subject: h('Subject'), body: m.snippet ?? '', receivedAt: h('Date') });
    }
    return out;
  }
}

// Microsoft (Outlook) — OAuth 2.0 + Microsoft Graph mail API.
class MicrosoftProvider implements Provider {
  key = 'outlook';
  scopes = OUTLOOK_SCOPES;
  constructor(private clientId: string, private clientSecret: string, private tenant: string) {}
  private base() { return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0`; }
  startAuth(tenantId: string, redirectUri: string) {
    const state = Buffer.from(`outlook:${tenantId}:${Date.now()}`).toString('base64url');
    const params = new URLSearchParams({
      client_id: this.clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: this.scopes.join(' '), response_mode: 'query', state,
    });
    return { authUrl: `${this.base()}/authorize?${params.toString()}`, state };
  }
  async exchange(code: string) {
    const res = await fetch(`${this.base()}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: env.INTEGRATIONS_REDIRECT_URI, grant_type: 'authorization_code', scope: this.scopes.join(' ') }).toString(),
    });
    if (!res.ok) throw new Error(`microsoft_token_exchange_failed: ${res.status}`);
    const j: any = await res.json();
    let account = 'outlook_account';
    try {
      const me = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { authorization: `Bearer ${j.access_token}` } });
      if (me.ok) { const p = (await me.json()) as any; account = p.mail ?? p.userPrincipalName ?? account; }
    } catch { /* best-effort */ }
    return { providerAccountId: account, accessToken: j.access_token, refreshToken: j.refresh_token ?? '', scopes: this.scopes };
  }
  async fetchEmails(accessToken: string): Promise<RawEmail[]> {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=from,subject,bodyPreview,receivedDateTime', { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`graph_messages_failed: ${res.status}`);
    const items = (((await res.json()) as any).value ?? []) as any[];
    return items.map((m) => ({ from: m.from?.emailAddress?.address ?? '', subject: m.subject ?? '', body: m.bodyPreview ?? '', receivedAt: m.receivedDateTime ?? '' }));
  }
}

// Returns the LIVE driver for a provider if its credentials are configured, else null.
export function liveProviderFor(key: string): Provider | null {
  if (key === 'gmail' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return new GoogleProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  if (key === 'outlook' && env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) return new MicrosoftProvider(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET, env.MICROSOFT_TENANT);
  return null;
}
export function isProviderLive(key: string): boolean {
  return liveProviderFor(key) !== null;
}
// True when at least one real email provider is configured — used to open Connected
// Services to all subscribed users (otherwise it stays internal-tester-only).
export function anyProviderLive(): boolean {
  return isProviderLive('gmail') || isProviderLive('outlook');
}

// Generic mail scopes for providers connected by OAuth or an app-specific password (IMAP).
const MAIL_SCOPES = ['mail.read'];
const SANDBOX: Record<string, Provider> = {
  mock: new SandboxProvider('mock', ['mock.read']),
  gmail: new SandboxProvider('gmail', GMAIL_SCOPES),
  outlook: new SandboxProvider('outlook', OUTLOOK_SCOPES),
  yahoo: new SandboxProvider('yahoo', MAIL_SCOPES),
  icloud: new SandboxProvider('icloud', MAIL_SCOPES),
  imap: new SandboxProvider('imap', MAIL_SCOPES),
};
// Back-compat export (kept for any existing imports).
export const PROVIDERS = SANDBOX;

export function getProvider(key: string): Provider {
  const live = liveProviderFor(key);
  if (live) return live;
  const p = SANDBOX[key];
  if (!p) throw new Error('unknown_provider');
  return p;
}

// Public provider listing for the API/UI: which providers exist and whether each is live.
export function listProviders(): { key: string; scopes: string[]; kind: string; live: boolean }[] {
  return [
    { key: 'gmail', scopes: GMAIL_SCOPES, kind: 'email', live: isProviderLive('gmail') },
    { key: 'outlook', scopes: OUTLOOK_SCOPES, kind: 'email', live: isProviderLive('outlook') },
    { key: 'yahoo', scopes: MAIL_SCOPES, kind: 'email', live: isProviderLive('yahoo') },
    { key: 'icloud', scopes: MAIL_SCOPES, kind: 'email', live: isProviderLive('icloud') },
    { key: 'imap', scopes: MAIL_SCOPES, kind: 'email', live: isProviderLive('imap') },
  ];
}
