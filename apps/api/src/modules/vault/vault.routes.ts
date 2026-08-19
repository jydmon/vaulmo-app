import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import { documents, reminders, fileObjects, tenants } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { storage, sha256 } from '../../lib/storage';
import { catalogueForCountry, recommendedForCountry, publicSchema, byKey } from '../../lib/catalogue';
import { ocrExtractText } from '../../lib/ocr';
import { classify } from '../../lib/classify';
import { extract, requiredFieldsPresent } from '../../lib/extract';
import { reindexDocument } from '../../lib/search';

// The vault is available to every authenticated, MFA-satisfied tenant user.
// (Subscription entitlement is the access control; the alpha internal-tester gate
// has been removed for the live user phase.)
export const vaultRouter = Router();
vaultRouter.use(requireAuth, requireMfaSatisfied);

async function tenantCountry(tenantId: string): Promise<string> {
  const [t] = await db.select({ country: tenants.country }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return t?.country ?? 'GB';
}
function tid(req: any): string {
  const t = req.auth?.tid;
  if (!t) throw new AppError(400, 'no_tenant', 'Only tenant users have a vault');
  return t;
}

// ---- Catalogue (country-specific) ----
vaultRouter.get('/catalogue', async (req, res) => {
  const country = await tenantCountry(tid(req));
  res.json({
    country,
    types: catalogueForCountry(country).map((t) => ({
      key: t.key, name: t.name, category: t.category, recommended: t.recommended, fields: publicSchema(t),
    })),
  });
});

// ---- Checklist + outstanding tracking + Vaulmo completion score ----
vaultRouter.get('/checklist', async (req, res) => {
  const tenantId = tid(req);
  const country = await tenantCountry(tenantId);
  const recommended = recommendedForCountry(country);
  const docs = await db.select().from(documents).where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));

  const items = recommended.map((rt) => {
    const match = docs.find((d) => (d.typeKey ?? d.classifiedTypeKey) === rt.key);
    const state = !match ? 'missing' : match.status === 'CONFIRMED' ? 'confirmed' : 'present';
    return { key: rt.key, name: rt.name, category: rt.category, state, documentId: match?.id ?? null };
  });

  const total = recommended.length;
  const confirmed = items.filter((i) => i.state === 'confirmed').length;
  const present = items.filter((i) => i.state === 'present').length;
  // Confirmed docs count fully; present-but-unconfirmed count half.
  const score = total === 0 ? 0 : Math.round((100 * (confirmed + 0.5 * present)) / total);

  res.json({
    completionScore: score,
    total,
    confirmed,
    present,
    outstanding: items.filter((i) => i.state === 'missing'),
    items,
  });
});

// ---- Create a document (Phase 2 upload / Phase 3 scan entrypoint) ----
const initSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
  title: z.string().min(1).max(160).optional(),
});
vaultRouter.post('/documents', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const body = initSchema.parse(req.body);
  const tenantId = tid(req);
  const key = storage.key(tenantId, body.filename);
  const [file] = await db
    .insert(fileObjects)
    .values({ tenantId, ownerId: req.auth!.sub, storageKey: key, filename: body.filename, contentType: body.contentType, sizeBytes: body.sizeBytes, status: 'PENDING' })
    .returning();
  const [doc] = await db
    .insert(documents)
    .values({ tenantId, ownerId: req.auth!.sub, fileId: file.id, title: body.title ?? body.filename, status: 'DRAFT' })
    .returning();
  const presigned = await storage.presignUpload(key, body.contentType);
  await audit({ action: 'document.created', actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: doc.id, req });
  res.status(201).json({ documentId: doc.id, fileId: file.id, uploadUrl: presigned.url, method: presigned.method, storageKey: key });
});

// ---- Process: OCR → classify → extract  (Scan → Extract) ----
// Produces UNCONFIRMED metadata and DRAFT (not live) reminders.
vaultRouter.post('/documents/:id/process', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const tenantId = tid(req);
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tenantId))).limit(1);
  if (!doc) throw new AppError(404, 'not_found', 'Document not found');
  if (!doc.fileId) throw new AppError(400, 'no_file', 'No file attached');
  const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, doc.fileId)).limit(1);
  if (!file || file.status !== 'STORED') throw new AppError(400, 'file_not_stored', 'Upload the file before processing');

  const country = await tenantCountry(tenantId);
  const bytes = await storage.getObject(file.storageKey);
  const ocr = await ocrExtractText(bytes, file.contentType, file.filename);
  const cls = classify(ocr.text, country);
  const ext = cls.typeKey ? extract(ocr.text, cls.typeKey) : { fields: [], metadata: {}, reminderCandidates: [] };

  // Every field the AI extracted is tagged with provenance 'ai' (AIX-07). The user's
  // edits later overwrite individual entries with 'manual'.
  const aiSources: Record<string, string> = {};
  for (const k of Object.keys(ext.metadata ?? {})) aiSources[k] = 'ai';

  await db
    .update(documents)
    .set({
      ocrText: ocr.text.slice(0, 20000),
      classifiedTypeKey: cls.typeKey,
      classificationConfidence: cls.confidence,
      typeKey: cls.typeKey,
      extractedMetadata: { fields: ext.fields, metadata: ext.metadata } as any,
      metadataSources: aiSources as any,
      status: 'AWAITING_CONFIRM',
      updatedAt: new Date(),
    })
    .where(eq(documents.id, doc.id));

  await reindexDocument(doc.id); // update the search index (Phase 5)

  // Create DRAFT reminders — explicitly NOT live until the user confirms.
  await db.delete(reminders).where(and(eq(reminders.documentId, doc.id), eq(reminders.status, 'DRAFT')));
  for (const rc of ext.reminderCandidates) {
    await db.insert(reminders).values({
      tenantId, documentId: doc.id, kind: rc.kind, title: rc.title, dueDate: rc.dueDate, status: 'DRAFT', source: 'extracted',
    });
  }

  await audit({
    action: 'document.extracted',
    actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: doc.id,
    metadata: { engine: ocr.engine, classifiedAs: cls.typeKey, confidence: cls.confidence, fields: ext.fields.length, draftReminders: ext.reminderCandidates.length },
    req,
  });

  res.json({
    documentId: doc.id,
    engine: ocr.engine,
    classification: cls,
    extracted: ext.fields,
    draftReminders: ext.reminderCandidates,
    status: 'AWAITING_CONFIRM',
    note: 'Metadata is UNCONFIRMED. Reminders are DRAFT and will not go live until you confirm.',
  });
});

// ---- Edit extracted metadata before confirming (Metadata editing) ----
const editSchema = z.object({
  typeKey: z.string().optional(),
  title: z.string().min(1).max(160).optional(),
  metadata: z.record(z.string()).optional(),
});
vaultRouter.patch('/documents/:id', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const tenantId = tid(req);
  const body = editSchema.parse(req.body);
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tenantId))).limit(1);
  if (!doc) throw new AppError(404, 'not_found', 'Document not found');
  if (doc.status === 'CONFIRMED') throw new AppError(409, 'already_confirmed', 'Confirmed documents cannot be edited here');

  const current = (doc.extractedMetadata as any) ?? { fields: [], metadata: {} };
  const mergedMeta = { ...(current.metadata ?? {}), ...(body.metadata ?? {}) };
  // Any field the user typed here is provenance 'manual' (corrected or added) (AIX-07).
  const sources: Record<string, string> = { ...((doc.metadataSources as any) ?? {}) };
  for (const k of Object.keys(body.metadata ?? {})) sources[k] = 'manual';
  await db
    .update(documents)
    .set({
      typeKey: body.typeKey ?? doc.typeKey,
      title: body.title ?? doc.title,
      extractedMetadata: { ...current, metadata: mergedMeta } as any,
      metadataSources: sources as any,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, doc.id));
  await audit({ action: 'document.metadata.edited', actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: doc.id, req });
  res.json({ documentId: doc.id, metadata: mergedMeta, metadataSources: sources, typeKey: body.typeKey ?? doc.typeKey });
});

// ---- Confirm → Store (activates reminders) ----
const confirmSchema = z.object({ metadata: z.record(z.string()).optional(), typeKey: z.string().optional() });
vaultRouter.post('/documents/:id/confirm', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const tenantId = tid(req);
  const body = confirmSchema.parse(req.body);
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tenantId))).limit(1);
  if (!doc) throw new AppError(404, 'not_found', 'Document not found');

  const extracted = (doc.extractedMetadata as any) ?? { metadata: {} };
  const finalMeta: Record<string, string> = { ...(extracted.metadata ?? {}), ...(body.metadata ?? {}) };
  const typeKey = body.typeKey ?? doc.typeKey ?? doc.classifiedTypeKey ?? undefined;
  if (!typeKey) throw new AppError(422, 'no_type', 'Set a document type before confirming');
  if (!requiredFieldsPresent(typeKey, finalMeta)) {
    const def = byKey(typeKey);
    const missing = def?.fields.filter((f) => f.required && !finalMeta[f.key]).map((f) => f.label) ?? [];
    throw new AppError(422, 'missing_required', `Required fields still missing: ${missing.join(', ')}`);
  }

  const confirmSources: Record<string, string> = { ...((doc.metadataSources as any) ?? {}) };
  for (const k of Object.keys(body.metadata ?? {})) confirmSources[k] = 'manual';
  await db
    .update(documents)
    .set({ status: 'CONFIRMED', typeKey, confirmedMetadata: finalMeta as any, metadataSources: confirmSources as any, updatedAt: new Date() })
    .where(eq(documents.id, doc.id));
  await reindexDocument(doc.id); // re-index with confirmed metadata (Phase 5)

  // NOW reminders go live — only on explicit confirmation.
  const activated = await db
    .update(reminders)
    .set({ status: 'ACTIVE', activatedAt: new Date() })
    .where(and(eq(reminders.documentId, doc.id), eq(reminders.status, 'DRAFT')))
    .returning();

  await audit({
    action: 'document.confirmed',
    actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: doc.id,
    metadata: { typeKey, remindersActivated: activated.length },
    req,
  });
  res.json({ documentId: doc.id, status: 'CONFIRMED', confirmedMetadata: finalMeta, remindersActivated: activated.length });
});

// ---- List / detail / preview ----
// By default only current, non-deleted documents are returned. Pass ?includeHistory=1
// to also see superseded prior versions (VLT-08) — deleted documents stay hidden.
vaultRouter.get('/documents', requirePermission(PERMISSIONS.FILE_READ), async (req, res) => {
  const includeHistory = req.query.includeHistory === '1' || req.query.includeHistory === 'true';
  const conditions = [eq(documents.tenantId, tid(req)), isNull(documents.deletedAt)];
  if (!includeHistory) conditions.push(isNull(documents.replacedByDocumentId));
  const list = await db.select().from(documents).where(and(...conditions)).orderBy(desc(documents.createdAt));
  res.json({ documents: list });
});

vaultRouter.get('/documents/:id', requirePermission(PERMISSIONS.FILE_READ), async (req, res) => {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tid(req)), isNull(documents.deletedAt))).limit(1);
  if (!doc) throw new AppError(404, 'not_found', 'Document not found');
  let previewUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (doc.fileId) {
    const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, doc.fileId)).limit(1);
    if (file) {
      previewUrl = `/api/v1/vault/documents/${doc.id}/preview`;
      downloadUrl = `/api/v1/vault/documents/${doc.id}/download`;
    }
  }
  res.json({ document: doc, metadataSources: doc.metadataSources ?? {}, previewUrl, downloadUrl });
});

// Document preview — streams the bytes, tenant-scoped.
vaultRouter.get('/documents/:id/preview', requirePermission(PERMISSIONS.FILE_READ), async (req, res) => {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tid(req)))).limit(1);
  if (!doc || !doc.fileId) throw new AppError(404, 'not_found', 'No preview available');
  const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, doc.fileId)).limit(1);
  if (!file) throw new AppError(404, 'not_found', 'File missing');
  const bytes = await storage.getObject(file.storageKey);
  res.setHeader('content-type', file.contentType);
  res.setHeader('content-disposition', `inline; filename="${file.filename}"`);
  res.send(bytes);
});

// ---- Document download (VLT-07) — same bytes as preview but as an attachment ----
vaultRouter.get('/documents/:id/download', requirePermission(PERMISSIONS.FILE_READ), async (req, res) => {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tid(req)), isNull(documents.deletedAt))).limit(1);
  if (!doc || !doc.fileId) throw new AppError(404, 'not_found', 'No file to download');
  const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, doc.fileId)).limit(1);
  if (!file) throw new AppError(404, 'not_found', 'File missing');
  const bytes = await storage.getObject(file.storageKey);
  await audit({ action: 'document.downloaded', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'document', targetId: doc.id, req });
  res.setHeader('content-type', file.contentType || 'application/octet-stream');
  res.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
  res.send(bytes);
});

// ---- Document deletion (VLT-09) — soft-delete, retains the row for audit/retention ----
vaultRouter.delete('/documents/:id', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const tenantId = tid(req);
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tenantId), isNull(documents.deletedAt))).limit(1);
  if (!doc) throw new AppError(404, 'not_found', 'Document not found');
  await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, doc.id));
  // Its reminders are no longer relevant.
  await db.delete(reminders).where(and(eq(reminders.documentId, doc.id), eq(reminders.status, 'DRAFT')));
  await db.update(reminders).set({ status: 'DISMISSED' }).where(and(eq(reminders.documentId, doc.id), eq(reminders.status, 'ACTIVE')));
  await audit({ action: 'document.deleted', actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: doc.id, req });
  res.json({ documentId: doc.id, deleted: true });
});

// ---- Document replacement / versioning (VLT-08) ----
// Creates a NEW document version linked to the old one; the old version is kept as
// history (marked replaced) rather than destroyed. Returns an upload URL for the new file.
vaultRouter.post('/documents/:id/replace', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const tenantId = tid(req);
  const body = initSchema.parse(req.body);
  const [old] = await db.select().from(documents).where(and(eq(documents.id, req.params.id), eq(documents.tenantId, tenantId), isNull(documents.deletedAt))).limit(1);
  if (!old) throw new AppError(404, 'not_found', 'Document not found');
  if (old.replacedByDocumentId) throw new AppError(409, 'already_replaced', 'This version has already been replaced');

  const key = storage.key(tenantId, body.filename);
  const [file] = await db
    .insert(fileObjects)
    .values({ tenantId, ownerId: req.auth!.sub, storageKey: key, filename: body.filename, contentType: body.contentType, sizeBytes: body.sizeBytes, status: 'PENDING' })
    .returning();
  const [next] = await db
    .insert(documents)
    .values({
      tenantId, ownerId: req.auth!.sub, fileId: file.id,
      title: body.title ?? old.title,
      typeKey: old.typeKey,
      status: 'DRAFT',
      version: (old.version ?? 1) + 1,
      previousVersionId: old.id,
    })
    .returning();
  await db.update(documents).set({ replacedByDocumentId: next.id, updatedAt: new Date() }).where(eq(documents.id, old.id));
  const presigned = await storage.presignUpload(key, body.contentType);
  await audit({ action: 'document.replaced', actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: next.id, metadata: { previousVersionId: old.id, version: next.version }, req });
  res.status(201).json({ documentId: next.id, previousVersionId: old.id, version: next.version, fileId: file.id, uploadUrl: presigned.url, method: presigned.method, storageKey: key });
});

// ---- Reminders (live vs draft) ----
vaultRouter.get('/reminders', requirePermission(PERMISSIONS.FILE_READ), async (req, res) => {
  const tenantId = tid(req);
  const all = await db.select().from(reminders).where(eq(reminders.tenantId, tenantId)).orderBy(desc(reminders.createdAt));
  res.json({
    live: all.filter((r) => r.status === 'ACTIVE'),
    draft: all.filter((r) => r.status === 'DRAFT'),
  });
});
