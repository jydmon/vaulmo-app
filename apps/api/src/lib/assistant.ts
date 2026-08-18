import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { reminders, documents, tenants } from '../db/schema';
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

export async function ask(tenantId: string, question: string): Promise<Answer> {
  const hits = await searchDocuments(tenantId, question, 5);
  if (!hits.length) {
    return { answer: "I couldn't find anything about that in your vault.", sources: [], retrieved: 0 };
  }
  const top = hits[0];
  const sources: Source[] = hits.map((h) => ({ documentId: h.documentId, title: h.title, typeKey: h.typeKey, ref: h.title }));
  const ql = question.toLowerCase();

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

  const docs = await db.select().from(documents).where(eq(documents.tenantId, tenantId));
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
