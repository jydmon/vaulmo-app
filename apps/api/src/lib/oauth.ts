import jwt from 'jsonwebtoken';
import { env } from '../env';

// Social sign-in providers (ACC-02). Credentials-ready: a provider is only offered when
// its client credentials are present in the environment; otherwise the button is hidden
// and the endpoints report it as unavailable. Google & Microsoft use standard OIDC;
// Apple additionally needs a signed (ES256) client secret built from its key material.
export type OAuthProvider = 'google' | 'microsoft' | 'apple';
export interface OAuthProfile { email: string; name?: string; emailVerified: boolean; provider: OAuthProvider }

export function providerConfigured(p: OAuthProvider): boolean {
  if (p === 'google') return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (p === 'microsoft') return !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
  if (p === 'apple') return !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
  return false;
}
export function configuredProviders(): OAuthProvider[] {
  return (['google', 'microsoft', 'apple'] as OAuthProvider[]).filter(providerConfigured);
}

const redirectUri = (p: OAuthProvider) => `${env.APP_BASE_URL}/api/v1/auth/oauth/${p}/callback`;

export function authorizeUrl(p: OAuthProvider, state: string): string {
  const rid = redirectUri(p);
  if (p === 'google') {
    const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: rid, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  if (p === 'microsoft') {
    const q = new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID!, redirect_uri: rid, response_type: 'code', scope: 'openid email profile', state, response_mode: 'query' });
    return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/authorize?${q}`;
  }
  const q = new URLSearchParams({ client_id: env.APPLE_CLIENT_ID!, redirect_uri: rid, response_type: 'code', scope: 'name email', state, response_mode: 'form_post' });
  return `https://appleid.apple.com/auth/authorize?${q}`;
}

// Apple's client secret is a short-lived ES256 JWT signed with the .p8 key.
function appleClientSecret(): string {
  const key = (env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return jwt.sign({}, key, {
    algorithm: 'ES256', issuer: env.APPLE_TEAM_ID!, audience: 'https://appleid.apple.com',
    subject: env.APPLE_CLIENT_ID!, keyid: env.APPLE_KEY_ID!, expiresIn: '5m',
  });
}

// Decode a JWT payload (no signature check needed: the id_token is fetched directly from
// the provider's token endpoint over TLS in a server-to-server call).
function decodeJwt(token: string): any {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

export async function exchangeCode(p: OAuthProvider, code: string): Promise<OAuthProfile> {
  const rid = redirectUri(p);
  if (p === 'google') {
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: rid, grant_type: 'authorization_code' }),
    });
    const tj = (await tok.json()) as any;
    if (!tok.ok) throw new Error(tj.error_description || 'google_token_failed');
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${tj.access_token}` } });
    const u = (await ui.json()) as any;
    if (!u.email) throw new Error('google_no_email');
    return { email: String(u.email).toLowerCase(), name: u.name, emailVerified: !!u.email_verified, provider: 'google' };
  }
  if (p === 'microsoft') {
    const tok = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.MICROSOFT_CLIENT_ID!, client_secret: env.MICROSOFT_CLIENT_SECRET!, redirect_uri: rid, grant_type: 'authorization_code', scope: 'openid email profile' }),
    });
    const tj = (await tok.json()) as any;
    if (!tok.ok) throw new Error(tj.error_description || 'microsoft_token_failed');
    const c = decodeJwt(tj.id_token);
    const email = String(c.email || c.preferred_username || '').toLowerCase();
    if (!email) throw new Error('microsoft_no_email');
    return { email, name: c.name, emailVerified: true, provider: 'microsoft' };
  }
  const tok = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.APPLE_CLIENT_ID!, client_secret: appleClientSecret(), redirect_uri: rid, grant_type: 'authorization_code' }),
  });
  const tj = (await tok.json()) as any;
  if (!tok.ok) throw new Error(tj.error_description || 'apple_token_failed');
  const c = decodeJwt(tj.id_token);
  if (!c.email) throw new Error('apple_no_email');
  return { email: String(c.email).toLowerCase(), emailVerified: c.email_verified === true || c.email_verified === 'true', provider: 'apple' };
}
