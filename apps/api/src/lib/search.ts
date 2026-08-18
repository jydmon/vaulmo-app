import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { documents } from '../db/schema';
import { byKey } from './catalogue';

// Builds/refreshes the searchable text for a document (title + type + OCR text +
// metadata values). Called whenever a document is processed or confirmed.
export async function reindexDocument(documentId: string): Promise<void> {
  const [d] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!d) return;
  const typeName = d.typeKey ? byKey(d.typeKey)?.name ?? d.typeKey : '';
  const meta = (d.confirmedMetadata as Record<string, string>) ?? (d.extractedMetadata as any)?.metadata ?? {};
  const metaText = Object.entries(meta).map(([k, v]) => `${k} ${v}`).join(' ');
  const searchText = [d.title, typeName, metaText, d.ocrText ?? ''].join(' \n ').slice(0, 30000);
  await db.update(documents).set({ searchText }).where(eq(documents.id, documentId));
}

export interface SearchHit {
  documentId: string;
  title: string;
  typeKey: string | null;
  status: string;
  metadata: Record<string, string>;
  rank: number;
}

// Permission-scoped retrieval. EVERY query is filtered by tenant_id — a caller can
// only ever retrieve documents belonging to their own tenant. Uses Postgres
// full-text ranking with a trigram/ILIKE fallback for fuzzy matches.
// (A vector/embedding retriever can be added behind this same function later.)
export async function searchDocuments(tenantId: string, query: string, limit = 5): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  // Retrieve documents matching ANY salient term (OR), then rank. This is the right
  // behaviour for a question like "when does my passport expire?" — we want the
  // passport even though "expire" and "expiry" stem differently.
  const tokens = (q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3);
  const orQuery = tokens.join(' | ');
  if (!orQuery) return [];
  const result = await db.execute(sql`
    SELECT id, title, type_key, status, confirmed_metadata, extracted_metadata,
      ts_rank(to_tsvector('english', coalesce(search_text,'')), to_tsquery('english', ${orQuery})) AS rank
    FROM documents
    WHERE tenant_id = ${tenantId}
      AND (
        to_tsvector('english', coalesce(search_text,'')) @@ to_tsquery('english', ${orQuery})
        OR search_text ILIKE ${'%' + q + '%'}
      )
    ORDER BY rank DESC NULLS LAST, updated_at DESC
    LIMIT ${limit}
  `);
  const rows = (result as any).rows ?? [];
  return rows.map((r: any) => ({
    documentId: r.id,
    title: r.title,
    typeKey: r.type_key,
    status: r.status,
    metadata: (r.confirmed_metadata as any) ?? (r.extracted_metadata as any)?.metadata ?? {},
    rank: Number(r.rank ?? 0),
  }));
}
