import { Router, raw } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { documents, fileObjects } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requireModule } from '../../middleware/requireModule';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { storage, sha256 } from '../../lib/storage';
import { processPassportPhoto } from '../../lib/passport';

// Passport-photo tool (VLT-10). Takes a casual head-and-shoulders photo and returns a
// compliant passport photo (face detected, background made white, cropped/sized to
// 35x45mm). Optionally saves the result straight into the vault as a document.
export const passportRouter = Router();
passportRouter.use(requireAuth, requireMfaSatisfied, requireModule('vault'));

function tid(req: any): string {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have a vault');
  return req.auth.tid;
}

// POST /passport/process — body is the raw image (image/*). Query ?save=1 stores the
// processed photo in the vault. Returns a base64 preview + metadata (+ documentId if saved).
passportRouter.post('/process', requirePermission(PERMISSIONS.FILE_WRITE), raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }), async (req, res) => {
  const input = req.body as Buffer;
  if (!input || !input.length) throw new AppError(400, 'no_image', 'Send the photo as the raw request body (image/*)');

  let result;
  try {
    result = await processPassportPhoto(input);
  } catch (e) {
    throw new AppError(422, 'process_failed', `Could not process the photo: ${(e as Error).message}`);
  }

  let documentId: string | null = null;
  if (req.query.save === '1' || req.query.save === 'true') {
    const tenantId = tid(req);
    const key = storage.key(tenantId, 'passport-photo.jpg');
    await storage.putObject(key, result.image, 'image/jpeg');
    const [file] = await db.insert(fileObjects).values({
      tenantId, ownerId: req.auth!.sub, storageKey: key, filename: 'passport-photo.jpg',
      contentType: 'image/jpeg', sizeBytes: result.image.length, checksumSha256: sha256(result.image), status: 'STORED',
    }).returning();
    const [doc] = await db.insert(documents).values({
      tenantId, ownerId: req.auth!.sub, fileId: file.id, title: 'Passport photo', typeKey: 'passport_photo', status: 'CONFIRMED',
    }).returning();
    documentId = doc.id;
    await audit({ action: 'passport.saved', actorId: req.auth!.sub, tenantId, targetType: 'document', targetId: doc.id, req });
  } else {
    await audit({ action: 'passport.processed', actorId: req.auth!.sub, tenantId: tid(req), metadata: result.meta as any, req });
  }

  res.json({
    meta: result.meta,
    documentId,
    preview: `data:image/jpeg;base64,${result.image.toString('base64')}`,
  });
});
