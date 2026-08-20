import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { connections, detectedItems } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requireInternalTester } from '../../middleware/internalTester';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { encrypt } from '../../lib/crypto';
import { getProvider, listProviders, anyProviderLive } from '../../lib/integrations/provider';
import { classifyEmail } from '../../lib/integrations/classifyEmail';
import { bankProvider, detectRecurring } from '../../lib/integrations/openBanking';
import { env } from '../../env';
import type { Request, Response, NextFunction } from 'express';

// Access gate: once a real email provider is configured (Google/Microsoft OAuth
// credentials present), Connected Services opens to all subscribed users. Until then
// it stays limited to internal testers so no one sees the sandbox mailbox by mistake.
function requireIntegrationsAccess(req: Request, res: Response, next: NextFunction) {
  if (anyProviderLive()) return next();
  return requireInternalTester(req, res, next);
}

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth, requireMfaSatisfied, requireIntegrationsAccess);
const tid = (req: any): string => {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts can connect services');
  return req.auth.tid;
};
const publicConn = (c: any) => ({ id: c.id, provider: c.provider, status: c.status, providerAccountId: c.providerAccountId, scopes: c.scopes, connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt });

integrationsRouter.get('/providers', (_req, res) => {
  res.json({
    providers: [
      ...listProviders(),
      { key: bankProvider.key, scopes: bankProvider.scopes, kind: 'bank', live: false },
    ],
  });
});

// ---- Open Banking (Phase 13, sandbox-first) ----
// Consent start + callback for the AISP. Sandbox driver in dev/CI; a real FCA-authorised
// AISP is wired behind the same interface for staging/prod, gated per environment.
integrationsRouter.post('/bank/connect', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const { authUrl, state } = bankProvider.startAuth(tid(req), 'https://app.lifehub.local/integrations/bank/callback');
  res.json({ authUrl, state });
});

integrationsRouter.post('/bank/callback', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const { code } = cbSchema.parse(req.body);
  const tok = await bankProvider.exchange(code);
  const [conn] = await db.insert(connections).values({
    tenantId: tid(req), provider: bankProvider.key, status: 'connected',
    providerAccountId: tok.providerAccountId,
    accessTokenEnc: encrypt(tok.accessToken), refreshTokenEnc: encrypt(tok.refreshToken),
    scopes: tok.scopes,
  }).returning();
  await audit({ action: 'integration.connected', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'connection', targetId: conn.id, metadata: { provider: bankProvider.key }, req });
  res.status(201).json({ connection: publicConn(conn) });
});

// Start OAuth — returns the provider consent URL (sandbox marker in dev).
integrationsRouter.post('/:provider/connect', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const provider = getProvider(req.params.provider);
  const { authUrl, state } = provider.startAuth(tid(req), env.INTEGRATIONS_REDIRECT_URI);
  res.json({ authUrl, state });
});

// OAuth callback — exchange the code and store ENCRYPTED tokens.
const cbSchema = z.object({ code: z.string().min(1) });
integrationsRouter.post('/:provider/callback', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const provider = getProvider(req.params.provider);
  const { code } = cbSchema.parse(req.body);
  const tok = await provider.exchange(code);
  const [conn] = await db.insert(connections).values({
    tenantId: tid(req), provider: provider.key, status: 'connected',
    providerAccountId: tok.providerAccountId,
    accessTokenEnc: encrypt(tok.accessToken), refreshTokenEnc: encrypt(tok.refreshToken),
    scopes: tok.scopes,
  }).returning();
  await audit({ action: 'integration.connected', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'connection', targetId: conn.id, metadata: { provider: provider.key }, req });
  res.status(201).json({ connection: publicConn(conn) });
});

// Connected Services page — tokens are NEVER returned.
integrationsRouter.get('/connections', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const rows = await db.select().from(connections).where(eq(connections.tenantId, tid(req))).orderBy(desc(connections.createdAt));
  res.json({ connections: rows.map(publicConn) });
});

// Synchronisation job — pulls items from the provider, classifies them, and creates
// pending detected_items with provenance (connectionId). Real deployments run this on a
// schedule/worker; here it's triggered on demand.
integrationsRouter.post('/connections/:id/sync', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const [conn] = await db.select().from(connections).where(and(eq(connections.id, req.params.id), eq(connections.tenantId, tid(req)))).limit(1);
  if (!conn) throw new AppError(404, 'not_found', 'Connection not found');
  if (conn.status === 'paused') throw new AppError(409, 'connection_paused', 'This connection is paused. Resume it to sync.');

  // Open Banking: pull transactions, detect recurring debits, and write PENDING
  // detected subscriptions. Nothing goes live until the user confirms each one.
  if (conn.provider === bankProvider.key) {
    const txns = await bankProvider.fetchTransactions('***');
    const candidates = detectRecurring(txns);
    let created = 0;
    for (const c of candidates) {
      // Skip if we already surfaced this merchant as pending (idempotent-ish re-sync).
      const [dupe] = await db.select().from(detectedItems)
        .where(and(eq(detectedItems.tenantId, conn.tenantId), eq(detectedItems.status, 'pending'), eq(detectedItems.rawFrom, c.merchant)))
        .limit(1);
      if (dupe) continue;
      await db.insert(detectedItems).values({
        tenantId: conn.tenantId, connectionId: conn.id, type: 'subscription', source: 'bank',
        rawSubject: `${c.name} — ${c.cycle} £${c.amount}`, rawFrom: c.merchant,
        extracted: { name: c.name, amount: c.amount, cycle: c.cycle, renewalDate: c.renewalDate, confidence: c.confidence, occurrences: c.occurrences } as any,
        status: 'pending',
      });
      created++;
    }
    await db.update(connections).set({ lastSyncAt: new Date() }).where(eq(connections.id, conn.id));
    await audit({ action: 'integration.synced', actorId: req.auth!.sub, tenantId: conn.tenantId, targetType: 'connection', targetId: conn.id, metadata: { created, kind: 'bank' }, req });
    res.json({ created, byType: { subscription: created } });
    return;
  }

  const provider = getProvider(conn.provider);
  // (token would be decrypted here and passed to the provider API)
  const emails = await provider.fetchEmails('***');
  let created = 0;
  const byType: Record<string, number> = {};
  for (const email of emails) {
    const det = classifyEmail(email);
    if (det.type === 'other') continue;
    await db.insert(detectedItems).values({
      tenantId: conn.tenantId, connectionId: conn.id, type: det.type, source: 'email',
      rawSubject: email.subject, rawFrom: email.from, extracted: det.extracted as any, status: 'pending',
    });
    byType[det.type] = (byType[det.type] ?? 0) + 1;
    created++;
  }
  await db.update(connections).set({ lastSyncAt: new Date() }).where(eq(connections.id, conn.id));
  await audit({ action: 'integration.synced', actorId: req.auth!.sub, tenantId: conn.tenantId, targetType: 'connection', targetId: conn.id, metadata: { created, byType }, req });
  res.json({ created, byType });
});

// INT-06: pause / resume synchronisation without disconnecting (tokens are kept).
integrationsRouter.post('/connections/:id/pause', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const [row] = await db.update(connections).set({ status: 'paused' })
    .where(and(eq(connections.id, req.params.id), eq(connections.tenantId, tid(req)))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Connection not found');
  await audit({ action: 'integration.paused', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'connection', targetId: row.id, req });
  res.json({ connection: publicConn(row) });
});
integrationsRouter.post('/connections/:id/resume', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const [row] = await db.update(connections).set({ status: 'connected' })
    .where(and(eq(connections.id, req.params.id), eq(connections.tenantId, tid(req)))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Connection not found');
  await audit({ action: 'integration.resumed', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'connection', targetId: row.id, req });
  res.json({ connection: publicConn(row) });
});

integrationsRouter.delete('/connections/:id', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const [row] = await db.update(connections).set({ status: 'disconnected', accessTokenEnc: null, refreshTokenEnc: null })
    .where(and(eq(connections.id, req.params.id), eq(connections.tenantId, tid(req)))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Connection not found');
  await audit({ action: 'integration.disconnected', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'connection', targetId: row.id, req });
  res.json({ ok: true });
});

// Detected items awaiting confirmation (provenance included).
integrationsRouter.get('/detected', requirePermission(PERMISSIONS.TENANT_READ), async (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const rows = await db.select().from(detectedItems).where(and(eq(detectedItems.tenantId, tid(req)), eq(detectedItems.status, status))).orderBy(desc(detectedItems.createdAt));
  res.json({ detected: rows });
});

integrationsRouter.post('/detected/:id/dismiss', requirePermission(PERMISSIONS.TENANT_MANAGE), async (req, res) => {
  const [row] = await db.update(detectedItems).set({ status: 'dismissed' }).where(and(eq(detectedItems.id, req.params.id), eq(detectedItems.tenantId, tid(req)))).returning();
  if (!row) throw new AppError(404, 'not_found', 'Detected item not found');
  res.json({ ok: true });
});

// ---- Webhook framework (unauthenticated provider callbacks) ----
export const integrationsWebhookRouter = Router();
integrationsWebhookRouter.post('/:provider', async (req, res) => {
  // A real handler verifies the provider signature and enqueues a sync. Framework stub.
  await audit({ action: 'integration.webhook', metadata: { provider: req.params.provider }, req });
  res.json({ received: true });
});
