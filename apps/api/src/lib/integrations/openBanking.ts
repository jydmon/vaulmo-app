// Open Banking framework (Phase 13, later stage). Same pattern as the email providers:
// one interface, a deterministic SANDBOX driver for dev/CI/internal-testers, and a real
// AISP driver (TrueLayer/Plaid/Tink) to be wired behind the same interface for staging/prod.
//
// IMPORTANT rollout constraints (per product spec):
//  - Ship the MOCK/sandbox integration first; real bank data only after an FCA-authorised
//    AISP contract, consent screens and a security review — gated per environment.
//  - Detection NEVER creates live reminders or subscriptions on its own. It only writes
//    PENDING detected_items; the user must confirm each one (same as the email inbox).

export interface BankTransaction {
  date: string; // ISO date
  description: string;
  merchant: string;
  amount: number; // positive GBP magnitude
  direction: 'debit' | 'credit';
}

export interface BankProvider {
  key: string;
  scopes: string[];
  startAuth(tenantId: string, redirectUri: string): { authUrl: string; state: string };
  exchange(code: string): Promise<{ providerAccountId: string; accessToken: string; refreshToken: string; scopes: string[] }>;
  fetchTransactions(accessToken: string): Promise<BankTransaction[]>;
}

// Deterministic synthetic statement (~4 months). Recurring: Netflix, Spotify, PureGym
// (monthly) and Amazon Prime (annual). Plus non-recurring noise the detector must ignore:
// variable groceries, one-off electronics, and a salary credit.
function sampleStatement(): BankTransaction[] {
  const t: BankTransaction[] = [];
  const push = (date: string, merchant: string, description: string, amount: number, direction: 'debit' | 'credit' = 'debit') =>
    t.push({ date, merchant, description, amount, direction });

  // Recurring monthly subscriptions (regular cadence, stable amount).
  push('2026-05-15', 'Netflix', 'NETFLIX.COM AMSTERDAM', 10.99);
  push('2026-06-15', 'Netflix', 'NETFLIX.COM AMSTERDAM', 10.99);
  push('2026-07-15', 'Netflix', 'NETFLIX.COM AMSTERDAM', 10.99);
  push('2026-08-15', 'Netflix', 'NETFLIX.COM AMSTERDAM', 10.99);

  push('2026-05-03', 'Spotify', 'SPOTIFY P0A1B2C3', 11.99);
  push('2026-06-03', 'Spotify', 'SPOTIFY P0A1B2C3', 11.99);
  push('2026-07-03', 'Spotify', 'SPOTIFY P0A1B2C3', 11.99);
  push('2026-08-03', 'Spotify', 'SPOTIFY P0A1B2C3', 11.99);

  push('2026-06-01', 'PureGym', 'PUREGYM LTD DD', 24.99);
  push('2026-07-01', 'PureGym', 'PUREGYM LTD DD', 24.99);
  push('2026-08-01', 'PureGym', 'PUREGYM LTD DD', 24.99);

  // Recurring annual subscription.
  push('2025-08-20', 'Amazon Prime', 'AMAZON PRIME MEMBERSHIP', 95.0);
  push('2026-08-20', 'Amazon Prime', 'AMAZON PRIME MEMBERSHIP', 95.0);

  // Noise — must NOT be detected as subscriptions.
  push('2026-08-11', 'Tesco', 'TESCO STORES 2245', 42.17);
  push('2026-07-28', 'Tesco', 'TESCO STORES 2245', 61.03);
  push('2026-08-06', 'Currys', 'CURRYS 0455 LONDON', 599.0);
  push('2026-08-09', 'Pret', 'PRET A MANGER 88', 4.85);
  push('2026-07-31', 'Acme Corp', 'ACME CORP SALARY', 3200.0, 'credit');

  return t;
}

class SandboxBankProvider implements BankProvider {
  key = 'openbanking';
  scopes = ['accounts', 'transactions'];
  startAuth(tenantId: string, redirectUri: string) {
    const state = Buffer.from(`openbanking:${tenantId}:sandbox`).toString('base64url');
    return { authUrl: `https://sandbox.aisp.local/consent?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`, state };
  }
  async exchange(code: string) {
    return { providerAccountId: `ob_acct_${code.slice(0, 6)}`, accessToken: `ob_at_${code}`, refreshToken: `ob_rt_${code}`, scopes: this.scopes };
  }
  async fetchTransactions(): Promise<BankTransaction[]> {
    return sampleStatement();
  }
}

export const bankProvider: BankProvider = new SandboxBankProvider();

// ---- Recurring-payment detection ----
export interface RecurringCandidate {
  name: string;
  merchant: string;
  amount: string; // formatted e.g. "10.99"
  cycle: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  occurrences: number;
  lastDate: string;
  renewalDate: string; // estimated next charge
  confidence: number; // 0..1
}

const DAY = 86400000;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function cycleFor(gapDays: number): RecurringCandidate['cycle'] | null {
  if (gapDays >= 6 && gapDays <= 8) return 'weekly';
  if (gapDays >= 26 && gapDays <= 35) return 'monthly';
  if (gapDays >= 84 && gapDays <= 100) return 'quarterly';
  if (gapDays >= 350 && gapDays <= 385) return 'annual';
  return null;
}
function addDays(iso: string, days: number): string {
  return new Date(+new Date(iso) + days * DAY).toISOString().slice(0, 10);
}

// Groups debits by merchant, then flags a group as recurring when it has >=2 charges of a
// stable amount at a regular (weekly/monthly/quarterly/annual) cadence. Returns candidates
// only — nothing is persisted or actioned here.
export function detectRecurring(txns: BankTransaction[]): RecurringCandidate[] {
  const groups = new Map<string, BankTransaction[]>();
  for (const tx of txns) {
    if (tx.direction !== 'debit') continue;
    const key = tx.merchant.trim().toLowerCase();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(tx);
  }

  const out: RecurringCandidate[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => +new Date(a.date) - +new Date(b.date));

    // Amount must be stable (ignore variable spend like groceries): max deviation <=5%.
    const amounts = sorted.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const maxDev = Math.max(...amounts.map((a) => Math.abs(a - avg))) / avg;
    if (maxDev > 0.05) continue;

    // Gaps between consecutive charges must be regular and map to a known cycle.
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(Math.round((+new Date(sorted[i].date) - +new Date(sorted[i - 1].date)) / DAY));
    const medGap = median(gaps);
    const cycle = cycleFor(medGap);
    if (!cycle) continue;
    // Every gap should be close to the median (no erratic timing).
    if (gaps.some((g) => Math.abs(g - medGap) > Math.max(4, medGap * 0.2))) continue;

    const last = sorted[sorted.length - 1];
    const regularity = 1 - Math.min(1, maxDev / 0.05) * 0.3;
    const countBoost = Math.min(1, sorted.length / 4);
    const confidence = Math.round(Math.min(0.99, 0.6 * regularity + 0.4 * countBoost) * 100) / 100;

    out.push({
      name: last.merchant,
      merchant: last.merchant,
      amount: avg.toFixed(2),
      cycle,
      occurrences: sorted.length,
      lastDate: last.date,
      renewalDate: addDays(last.date, Math.round(medGap)),
      confidence,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
