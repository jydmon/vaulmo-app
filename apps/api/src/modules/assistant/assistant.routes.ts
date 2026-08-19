import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { searchDocuments } from '../../lib/search';
import { ask, whatDoINeedToKnow } from '../../lib/assistant';
import { logAiUsage } from '../../lib/aiUsage';

export const assistantRouter = Router();
assistantRouter.use(requireAuth, requireMfaSatisfied, requirePermission(PERMISSIONS.FILE_READ));

function tid(req: any): string {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant users have an assistant');
  return req.auth.tid;
}

// Document + metadata + semantic (full-text) search — tenant-scoped.
const searchSchema = z.object({ query: z.string().min(1).max(300), limit: z.number().int().min(1).max(20).optional() });
assistantRouter.post('/search', async (req, res) => {
  const body = searchSchema.parse(req.body);
  const hits = await searchDocuments(tid(req), body.query, body.limit ?? 5);
  await logAiUsage({ userId: req.auth!.sub, tenantId: tid(req), feature: 'search', promptText: body.query, completionText: JSON.stringify(hits) });
  res.json({ results: hits });
});

// RAG assistant — answers only from the caller's own documents, with source refs.
const askSchema = z.object({ question: z.string().min(1).max(500) });
assistantRouter.post('/ask', async (req, res) => {
  const body = askSchema.parse(req.body);
  const result = await ask(tid(req), body.question);
  await audit({ action: 'assistant.ask', actorId: req.auth!.sub, tenantId: tid(req), metadata: { retrieved: result.retrieved }, req });
  await logAiUsage({ userId: req.auth!.sub, tenantId: tid(req), feature: 'assistant', promptText: body.question, completionText: JSON.stringify((result as any).answer ?? result) });
  res.json(result);
});

// "What do I need to know?" — a grounded brief from the tenant's own data.
assistantRouter.get('/whats-important', async (req, res) => {
  const brief = await whatDoINeedToKnow(tid(req));
  res.json(brief);
});
