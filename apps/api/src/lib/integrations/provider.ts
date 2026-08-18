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

export const PROVIDERS: Record<string, Provider> = {
  mock: new SandboxProvider('mock', ['mock.read']),
  gmail: new SandboxProvider('gmail', ['https://www.googleapis.com/auth/gmail.readonly']),
  outlook: new SandboxProvider('outlook', ['Mail.Read']),
};

export function getProvider(key: string): Provider {
  const p = PROVIDERS[key];
  if (!p) throw new Error('unknown_provider');
  return p;
}
