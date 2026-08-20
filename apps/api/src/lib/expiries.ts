import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { reminders, documents } from '../db/schema';

// Renewals & Expiries hub (AIX-11, INT-18/19/21, SEC-06).
//
// A single, deduplicated horizon of everything coming due for a household. The
// ACTIVE reminders table is the canonical spine — document expiry dates, asset
// renewals (MOT / tax / insurance) and subscription renewals all create ACTIVE
// reminders when confirmed. On top of that we also surface expiry/renewal dates
// captured on documents that never became a reminder (e.g. the user declined the
// draft), so nothing with a real date silently drops off the radar.

export type ExpiryCategory = 'Document' | 'Vehicle' | 'Property' | 'Subscription' | 'Warranty' | 'Renewal';

export interface ExpiryItem {
  title: string;
  category: ExpiryCategory;
  dueDate: string; // YYYY-MM-DD
  daysRemaining: number; // negative = overdue
  kind: string; // originating reminder kind or 'document'
  source: 'reminder' | 'document';
  documentId?: string | null;
  reminderId?: string | null;
}

export interface ExpiryHorizon {
  horizonDays: number;
  generatedAt: string;
  counts: { total: number; overdue: number; soon: number; upcoming: number; later: number };
  buckets: { overdue: ExpiryItem[]; soon: ExpiryItem[]; upcoming: ExpiryItem[]; later: ExpiryItem[] };
  items: ExpiryItem[]; // all, sorted by dueDate ascending
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (fromISO: string, toISO: string) =>
  Math.round((+new Date(toISO + 'T00:00:00Z') - +new Date(fromISO + 'T00:00:00Z')) / 86400000);

// Map an originating reminder kind (and title, as a hint) to a user-facing category.
function categoryForReminder(kind: string, title: string): ExpiryCategory {
  const t = title.toLowerCase();
  if (kind === 'asset_renewal') {
    if (/\b(mot|road tax|insurance|vehicle|car)\b/.test(t) && !/home/.test(t)) return 'Vehicle';
    if (/\b(home|property|mortgage|building)\b/.test(t)) return 'Property';
    return 'Renewal';
  }
  if (kind === 'renewal' || kind === 'subscription_renewal') return 'Subscription';
  if (/warrant/.test(t)) return 'Warranty';
  if (kind === 'expiry') return 'Document';
  return 'Renewal';
}

// Which document metadata keys carry a renewal/expiry date, and how to label them.
const DOC_DATE_KEYS: Record<string, { label: string; category: ExpiryCategory }> = {
  expiryDate: { label: 'expires', category: 'Document' },
  renewalDate: { label: 'renews', category: 'Renewal' },
  endDate: { label: 'ends', category: 'Renewal' },
  warrantyExpiry: { label: 'warranty expires', category: 'Warranty' },
  warrantyEnd: { label: 'warranty ends', category: 'Warranty' },
  motDate: { label: 'MOT due', category: 'Vehicle' },
  taxDate: { label: 'road tax due', category: 'Vehicle' },
  insuranceDate: { label: 'insurance renews', category: 'Vehicle' },
};

const dedupeKey = (i: { category: string; dueDate: string; title: string }) =>
  `${i.category}|${i.dueDate}|${i.title.trim().toLowerCase()}`;

export async function expiryHorizon(tenantId: string, withinDays: number, now = new Date()): Promise<ExpiryHorizon> {
  const today = now.toISOString().slice(0, 10);
  const horizon = Math.max(1, Math.min(1825, Math.floor(withinDays) || 365));

  const items: ExpiryItem[] = [];

  // 1) ACTIVE reminders with a real date — the canonical horizon.
  const live = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.status, 'ACTIVE')));
  for (const r of live) {
    if (!r.dueDate || !ISO_DATE.test(r.dueDate)) continue;
    items.push({
      title: r.title,
      category: categoryForReminder(r.kind, r.title),
      dueDate: r.dueDate,
      daysRemaining: daysBetween(today, r.dueDate),
      kind: r.kind,
      source: 'reminder',
      documentId: r.documentId ?? null,
      reminderId: r.id,
    });
  }

  // 2) Document metadata date fields not already represented by a reminder.
  const seen = new Set(items.map(dedupeKey));
  const docs = await db.select().from(documents).where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
  for (const d of docs) {
    const meta = ((d.extractedMetadata as any)?.metadata ?? d.extractedMetadata ?? {}) as Record<string, any>;
    if (!meta || typeof meta !== 'object') continue;
    for (const [key, spec] of Object.entries(DOC_DATE_KEYS)) {
      const value = meta[key];
      if (typeof value !== 'string' || !ISO_DATE.test(value)) continue;
      const item: ExpiryItem = {
        title: `${d.title} ${spec.label}`,
        category: spec.category,
        dueDate: value,
        daysRemaining: daysBetween(today, value),
        kind: 'document',
        source: 'document',
        documentId: d.id,
        reminderId: null,
      };
      const k = dedupeKey(item);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(item);
    }
  }

  // Keep only what falls within the horizon (overdue always included), sort soonest-first.
  const inHorizon = items.filter((i) => i.daysRemaining <= horizon).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const overdue = inHorizon.filter((i) => i.daysRemaining < 0);
  const soon = inHorizon.filter((i) => i.daysRemaining >= 0 && i.daysRemaining <= 30);
  const upcoming = inHorizon.filter((i) => i.daysRemaining > 30 && i.daysRemaining <= 90);
  const later = inHorizon.filter((i) => i.daysRemaining > 90);

  return {
    horizonDays: horizon,
    generatedAt: now.toISOString(),
    counts: { total: inHorizon.length, overdue: overdue.length, soon: soon.length, upcoming: upcoming.length, later: later.length },
    buckets: { overdue, soon, upcoming, later },
    items: inHorizon,
  };
}

// Parse a natural-language horizon out of a question ("in 6 months", "next 90 days",
// "expiring soon"). Returns a day count, or null if the question isn't horizon-shaped.
export function parseHorizonDays(question: string): number | null {
  const q = question.toLowerCase();
  const m = q.match(/(\d+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (/week/.test(unit)) return n * 7;
    if (/month/.test(unit)) return n * 30;
    if (/year/.test(unit)) return n * 365;
    return n; // days
  }
  // Horizon-shaped but no explicit number → treat "soon/coming/upcoming" as 6 months.
  if (/(expir|renew|due|coming up|upcoming|soon|next few|this year)/.test(q)) return 180;
  return null;
}
