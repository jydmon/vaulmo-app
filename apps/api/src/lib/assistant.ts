import { and, eq, isNull, ilike, or, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { reminders, documents, tenants, trips, purchases, trackedSubscriptions } from '../db/schema';
import { searchDocuments, type SearchHit } from './search';
import { recommendedForCountry } from './catalogue';
import { byKey } from './catalogue';

// Retrieval-augmented answers, STRICTLY permission-scoped: every fact used to build
// an answer is retrieved with a tenant_id filter, so an answer can only ever draw on
// the caller's own (or shared-with-them) information. Generation here is extractive
// (composed from retrieved facts) with explicit source references; an LLM can slot in
// behind the same retrieve→ground→answer shape without changing the guarantee.

export interface Source {
  documentId?: string;
  title: string;
  typeKey?: string | null;
  ref: string; // human reference, e.g. "Passport"
}

export interface Answer {
  answer: string;
  sources: Source[];
  retrieved: number;
}

function dateFieldFrom(hit: SearchHit): { label: string; value: string } | null {
  const def = hit.typeKey ? byKey(hit.typeKey) : undefined;
  if (!def) return null;
  for (const f of def.fields) {
    if (f.type === 'date' && hit.metadata[f.key]) return { label: f.label, value: hit.metadata[f.key] };
  }
  return null;
}

// ---- Cross-entity answers (AIX-14/15/16): trips, purchases, warranties ----
// The assistant routes travel/purchase/warranty questions to the relevant life
// records, so "what trips next month?", "find the receipt for my TV" and "is my
// washing machine under warranty?" are answerable — not just document questions.
// Salient content words from a question, minus common stop/intent words, so we match
// on nouns ("washing machine") rather than the whole sentence.
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'have', 'has', 'was', 'were', 'still', 'under', 'about', 'what', 'when', 'where', 'which', 'does', 'did', 'can', 'could', 'would', 'find', 'show', 'tell', 'get', 'got', 'any', 'all', 'this', 'that', 'these', 'those', 'with', 'from', 'into', 'out', 'off', 'now', 'next', 'coming', 'upcoming', 'trip', 'trips', 'travel', 'receipt', 'receipts', 'purchase', 'purchases', 'bought', 'buy', 'warranty', 'warranties', 'subscription', 'subscriptions', 'renew', 'renews', 'renewal', 'membership', 'expire', 'expires', 'expiry']);
function terms(q: string): string[] {
  return (q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));
}
// Build an OR of ILIKE `%token%` across the given columns for each salient term.
function anyTermMatches(cols: any[], q: string) {
  const t = terms(q);
  const likes = t.flatMap((w) => cols.map((c) => ilike(c, `%${w}%`)));
  return likes.length ? or(...likes) : undefined;
}

async function answerFromLifeRecords(tenantId: string, ql: string, raw: string): Promise<Answer | null> {
  // Travel / trips
  if (/(trip|travel|flight|holiday|vacation|hotel)/.test(ql)) {
    const match = anyTermMatches([trips.title, trips.destination], raw);
    const rows = await db.select().from(trips)
      .where(match ? and(eq(trips.tenantId, tenantId), or(match, ilike(trips.status, '%upcoming%'))) : eq(trips.tenantId, tenantId))
      .orderBy(desc(trips.startDate)).limit(5);
    if (rows.length) {
      const sources: Source[] = rows.map((t) => ({ title: t.title, ref: `Trip: ${t.title}` }));
      const list = rows.map((t) => `${t.title}${t.destination ? ` to ${t.destination}` : ''}${t.startDate ? ` (${t.startDate})` : ''}`).join('; ');
      return { answer: `Trips in your account: ${list}.`, sources, retrieved: rows.length };
    }
    return { answer: "I couldn't find any trips in your account.", sources: [], retrieved: 0 };
  }

  // Warranty
  if (/warrant/.test(ql)) {
    const match = anyTermMatches([purchases.item, purchases.merchant], raw);
    const rows = await db.select().from(purchases)
      .where(match ? and(eq(purchases.tenantId, tenantId), match) : eq(purchases.tenantId, tenantId)).limit(5);
    const withW = rows.filter((p) => p.warrantyExpiry);
    if (withW.length) {
      const p = withW[0];
      const active = p.warrantyExpiry! >= new Date().toISOString().slice(0, 10);
      const sources: Source[] = withW.map((r) => ({ title: r.item, ref: `Purchase: ${r.item}` }));
      return { answer: `Your ${p.item} warranty ${active ? 'is still active' : 'has expired'} — warranty expiry ${p.warrantyExpiry}. (Source: ${p.item}.)`, sources, retrieved: withW.length };
    }
    if (rows.length) return { answer: `I found "${rows[0].item}" but no warranty date is recorded for it.`, sources: [{ title: rows[0].item, ref: `Purchase: ${rows[0].item}` }], retrieved: rows.length };
    return { answer: "I couldn't find a matching purchase to check its warranty.", sources: [], retrieved: 0 };
  }

  // Purchase / receipt
  if (/(receipt|purchase|bought|buy|paid for)/.test(ql)) {
    const match = anyTermMatches([purchases.item, purchases.merchant], raw);
    const rows = await db.select().from(purchases)
      .where(match ? and(eq(purchases.tenantId, tenantId), match) : eq(purchases.tenantId, tenantId)).limit(5);
    if (rows.length) {
      const p = rows[0];
      const sources: Source[] = rows.map((r) => ({ title: r.item, ref: `Purchase: ${r.item}` }));
      return { answer: `Found your ${p.item}${p.merchant ? ` from ${p.merchant}` : ''}${p.purchaseDate ? ` (${p.purchaseDate})` : ''}${p.amount ? `, ${p.amount}` : ''}. (Source: ${p.item}.)`, sources, retrieved: rows.length };
    }
    return { answer: "I couldn't find a matching purchase or receipt.", sources: [], retrieved: 0 };
  }

  // Subscriptions
  if (/(subscription|renew|broadband|streaming|gym|membership)/.test(ql)) {
    const match = anyTermMatches([trackedSubscriptions.name, trackedSubscriptions.category], raw);
    const rows = await db.select().from(trackedSubscriptions)
      .where(match ? and(eq(trackedSubscriptions.tenantId, tenantId), match) : eq(trackedSubscriptions.tenantId, tenantId)).limit(5);
    if (rows.length) {
      const s = rows[0];
      const sources: Source[] = rows.map((r) => ({ title: r.name, ref: `Subscription: ${r.name}` }));
      return { answer: `${s.name}${s.amount ? ` — ${s.amount}` : ''}${s.renewalDate ? `, renews ${s.renewalDate}` : ''}. (Source: ${s.name}.)`, sources, retrieved: rows.length };
    }
    // fall through to documents if no subscription matched
  }
  return null;
}

export async function ask(tenantId: string, question: string): Promise<Answer> {
  const ql = question.toLowerCase();
  // Route life-record questions (trips, purchases, warranties, subscriptions) first.
  const life = await answerFromLifeRecords(tenantId, ql, question);
  if (life) return life;

  const hits = await searchDocuments(tenantId, question, 5);
  if (!hits.length) {
    return { answer: "I couldn't find anything about that in your vault.", sources: [], retrieved: 0 };
  }
  const top = hits[0];
  const sources: Source[] = hits.map((h) => ({ documentId: h.documentId, title: h.title, typeKey: h.typeKey, ref: h.title }));

  // Date-style questions → answer from the top document's confirmed date field.
  if (/(expire|expiry|renew|renewal|due|when|valid)/.test(ql)) {
    const df = dateFieldFrom(top);
    if (df) {
      return { answer: `Your ${top.title} — ${df.label.toLowerCase()}: ${df.value}. (Source: ${top.title}.)`, sources, retrieved: hits.length };
    }
  }
  // Otherwise summarise what was found + a metadata snippet from the top hit.
  const snippet = Object.entries(top.metadata).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ');
  const others = hits.slice(1).map((h) => h.title);
  let answer = `Based on your vault, the most relevant document is your ${top.title}${snippet ? ` (${snippet})` : ''}.`;
  if (others.length) answer += ` Related: ${others.join(', ')}.`;
  return { answer, sources, retrieved: hits.length };
}

export interface Brief {
  summary: string;
  overdue: any[];
  upcoming: any[];
  outstanding: { key: string; name: string }[];
  sources: Source[];
}

// "What do I need to know?" — a grounded brief built only from the tenant's own data.
export async function whatDoINeedToKnow(tenantId: string, now = new Date()): Promise<Brief> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const live = await db.select().from(reminders).where(and(eq(reminders.tenantId, tenantId), eq(reminders.status, 'ACTIVE')));
  const today = now.toISOString().slice(0, 10);
  const withDays = live
    .filter((r) => r.dueDate)
    .map((r) => ({ id: r.id, title: r.title, dueDate: r.dueDate!, kind: r.kind, days: Math.round((+new Date(r.dueDate + 'T00:00:00Z') - +new Date(today + 'T00:00:00Z')) / 86400000) }))
    .sort((a, b) => a.days - b.days);
  const overdue = withDays.filter((r) => r.days < 0);
  const upcoming = withDays.filter((r) => r.days >= 0);

  const docs = await db.select().from(documents).where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
  const present = new Set(docs.map((d) => d.typeKey ?? d.classifiedTypeKey).filter(Boolean) as string[]);
  const outstanding = recommendedForCountry(tenant?.country ?? 'GB')
    .filter((rt) => !present.has(rt.key))
    .map((rt) => ({ key: rt.key, name: rt.name }));

  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} item${overdue.length === 1 ? '' : 's'} overdue`);
  if (upcoming.length) parts.push(`${upcoming.length} coming up (next: ${upcoming[0].title} in ${upcoming[0].days} day${upcoming[0].days === 1 ? '' : 's'})`);
  if (outstanding.length) parts.push(`${outstanding.length} recommended document${outstanding.length === 1 ? '' : 's'} still missing`);
  const summary = parts.length ? `Here's what needs your attention: ${parts.join('; ')}.` : 'You are all caught up — nothing needs attention right now.';

  const sources: Source[] = [
    ...withDays.slice(0, 5).map((r) => ({ title: r.title, ref: `Reminder: ${r.title}` })),
  ];
  return { summary, overdue, upcoming, outstanding, sources };
}
