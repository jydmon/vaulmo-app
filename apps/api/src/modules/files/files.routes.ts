import { Router, raw } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { fileObjects } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { storage, sha256 } from '../../lib/storage';
import { audit } from '../../lib/audit';
import { AppError } from '../../middleware/error';

export const filesRouter = Router();

const initSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
});

// Step 1: request a presigned upload. Creates a PENDING file row scoped to the tenant.
filesRouter.post(
  '/init-upload',
  requireAuth,
  requireMfaSatisfied,
  requirePermission(PERMISSIONS.FILE_WRITE),
  async (req, res) => {
    const body = initSchema.parse(req.body);
    const tenantId = req.auth!.tid;
    if (!tenantId) throw new AppError(400, 'no_tenant', 'Only tenant users can upload files');

    const key = storage.key(tenantId, body.filename);
    const [file] = await db
      .insert(fileObjects)
      .values({
        tenantId,
        ownerId: req.auth!.sub,
        storageKey: key,
        filename: body.filename,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        status: 'PENDING',
      })
      .returning();
    const presigned = await storage.presignUpload(key, body.contentType);
    await audit({ action: 'file.init_upload', actorId: req.auth!.sub, tenantId, targetType: 'file', targetId: file.id, req });
    res.status(201).json({ fileId: file.id, uploadUrl: presigned.url, method: presigned.method, storageKey: key });
  },
);

// Local dev upload target (production uploads go straight to object storage).
filesRouter.put(
  '/local-upload/:key',
  requireAuth,
  requireMfaSatisfied,
  requirePermission(PERMISSIONS.FILE_WRITE),
  raw({ type: '*/*', limit: '50mb' }),
  async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const [file] = await db
      .select()
      .from(fileObjects)
      .where(and(eq(fileObjects.storageKey, key), eq(fileObjects.tenantId, req.auth!.tid ?? '')))
      .limit(1);
    if (!file) throw new AppError(404, 'not_found', 'File not found for this tenant');
    const data = req.body as Buffer;
    await storage.putObject(key, data, file.contentType);
    const [updated] = await db
      .update(fileObjects)
      .set({ status: 'STORED', sizeBytes: data.length, checksumSha256: sha256(data) })
      .where(eq(fileObjects.id, file.id))
      .returning();
    await audit({ action: 'file.upload', actorId: req.auth!.sub, tenantId: file.tenantId, targetType: 'file', targetId: file.id, req });
    res.json({ fileId: updated.id, status: updated.status, checksum: updated.checksumSha256 });
  },
);

// List the caller's tenant files (tenant isolation enforced by the tid filter).
filesRouter.get(
  '/',
  requireAuth,
  requireMfaSatisfied,
  requirePermission(PERMISSIONS.FILE_READ),
  async (req, res) => {
    const files = await db
      .select()
      .from(fileObjects)
      .where(eq(fileObjects.tenantId, req.auth!.tid ?? ''))
      .orderBy(desc(fileObjects.createdAt));
    res.json({ files });
  },
);
