import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { broadcasts, broadcastReads, conversations, conversationMessages, users } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requireAnyPermission, requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { sendEmail } from '../../lib/notify';

// Get (or lazily create) the single support-chat conversation for an app user.
async function myConversation(userId: string, tenantId: string | null, name: string) {
  const [c] = await db.select().from(conversations)
    .where(and(eq(conversations.source, 'app'), eq(conversations.userId, userId))).limit(1);
  if (c) return c;
  const [n] = await db.insert(conversations).values({ source: 'app', userId, tenantId, name, subject: 'Support chat' }).returning();
  return n;
}

// ================= User-facing: message board (read) + support chat =================
export const commsRouter = Router();
commsRouter.use(requireAuth, requireMfaSatisfied);

// The broadcast message board — active messages with per-user read state.
commsRouter.get('/broadcasts', async (req, res) => {
  const rows = await db.select().from(broadcasts).where(eq(broadcasts.active, true)).orderBy(desc(broadcasts.createdAt));
  const reads = await db.select().from(broadcastReads).where(eq(broadcastReads.userId, req.auth!.sub));
  const readSet = new Set(reads.map((r) => r.broadcastId));
  const list = rows.map((b) => ({ id: b.id, title: b.title, body: b.body, level: b.level, createdAt: b.createdAt, read: readSet.has(b.id) }));
  res.json({ broadcasts: list, unread: list.filter((b) => !b.read).length });
});
commsRouter.post('/broadcasts/:id/read', async (req, res) => {
  await db.insert(broadcastReads).values({ broadcastId: req.params.id, userId: req.auth!.sub }).onConflictDoNothing();
  res.json({ ok: true });
});
commsRouter.post('/broadcasts/read-all', async (req, res) => {
  const rows = await db.select({ id: broadcasts.id }).from(broadcasts).where(eq(broadcasts.active, true));
  if (rows.length) await db.insert(broadcastReads).values(rows.map((r) => ({ broadcastId: r.id, userId: req.auth!.sub }))).onConflictDoNothing();
  res.json({ ok: true });
});

// In-app support chat (user ↔ staff), backed by the unified conversations model.
commsRouter.get('/chat', async (req, res) => {
  const [u] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  const c = await myConversation(req.auth!.sub, req.auth!.tid ?? null, u?.name ?? '');
  const msgs = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, c.id)).orderBy(conversationMessages.createdAt);
  if (c.unreadUser > 0) await db.update(conversations).set({ unreadUser: 0 }).where(eq(conversations.id, c.id));
  res.json({ conversation: { id: c.id, status: c.status }, messages: msgs.map((m) => ({ id: m.id, role: m.authorRole, body: m.body, createdAt: m.createdAt })) });
});
commsRouter.post('/chat/messages', async (req, res) => {
  const { body } = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);
  const [u] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, req.auth!.sub)).limit(1);
  const c = await myConversation(req.auth!.sub, req.auth!.tid ?? null, u?.name ?? '');
  await db.insert(conversationMessages).values({ conversationId: c.id, authorRole: 'user', authorId: req.auth!.sub, body: body.trim() });
  await db.update(conversations).set({ lastMessageAt: new Date(), unreadStaff: c.unreadStaff + 1, status: 'open' }).where(eq(conversations.id, c.id));
  await audit({ action: 'comms.chat.message', actorId: req.auth!.sub, req });
  res.status(201).json({ ok: true });
});
// Small unread counter for the sidebar badge (staff replies the user hasn't opened).
commsRouter.get('/chat/unread', async (req, res) => {
  const [c] = await db.select({ unread: conversations.unreadUser }).from(conversations)
    .where(and(eq(conversations.source, 'app'), eq(conversations.userId, req.auth!.sub))).limit(1);
  res.json({ unread: c?.unread ?? 0 });
});

// ================= Admin: broadcasts authoring + conversations inbox =================
export const adminCommsRouter = Router();
const guard = [requireAuth, requireMfaSatisfied, requireAnyPermission(PERMISSIONS.PLATFORM_MANAGE, PERMISSIONS.SUPPORT_MANAGE)];
adminCommsRouter.use(...guard);

const broadcastSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(8000),
  level: z.enum(['info', 'warning', 'critical']).default('info'),
  active: z.boolean().default(true),
});
adminCommsRouter.get('/broadcasts', async (_req, res) => {
  const rows = await db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt));
  const reads = await db.select({ broadcastId: broadcastReads.broadcastId, n: sql<number>`count(*)::int` })
    .from(broadcastReads).groupBy(broadcastReads.broadcastId);
  const readCount = new Map(reads.map((r) => [r.broadcastId, Number(r.n)]));
  res.json({ broadcasts: rows.map((b) => ({ ...b, readCount: readCount.get(b.id) ?? 0 })) });
});
adminCommsRouter.post('/broadcasts', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = broadcastSchema.parse(req.body);
  const [row] = await db.insert(broadcasts).values({ ...b, createdBy: req.auth!.sub }).returning();
  await audit({ action: 'comms.broadcast.created', actorId: req.auth!.sub, targetType: 'broadcast', targetId: row.id, req });
  res.status(201).json({ broadcast: row });
});
adminCommsRouter.patch('/broadcasts/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const b = broadcastSchema.partial().parse(req.body);
  const [row] = await db.update(broadcasts).set(b).where(eq(broadcasts.id, req.params.id)).returning();
  if (!row) throw new AppError(404, 'not_found', 'Broadcast not found');
  await audit({ action: 'comms.broadcast.updated', actorId: req.auth!.sub, targetId: req.params.id, req });
  res.json({ broadcast: row });
});
adminCommsRouter.delete('/broadcasts/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  await db.delete(broadcasts).where(eq(broadcasts.id, req.params.id));
  await audit({ action: 'comms.broadcast.deleted', actorId: req.auth!.sub, targetId: req.params.id, req });
  res.json({ deleted: true });
});

// Conversations inbox (both app support chats and website chat hand-offs).
adminCommsRouter.get('/conversations', async (req, res) => {
  const src = String((req.query as any).source ?? '');
  const where = src === 'app' || src === 'website' ? eq(conversations.source, src) : undefined;
  const rows = await db.select().from(conversations).where(where as any).orderBy(desc(conversations.lastMessageAt)).limit(300);
  const [{ unread }] = await db.select({ unread: sql<number>`coalesce(sum(unread_staff),0)::int` }).from(conversations);
  res.json({ conversations: rows, unread: Number(unread) || 0 });
});
adminCommsRouter.get('/conversations/:id', async (req, res) => {
  const [c] = await db.select().from(conversations).where(eq(conversations.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Conversation not found');
  const msgs = await db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, c.id)).orderBy(conversationMessages.createdAt);
  if (c.unreadStaff > 0) await db.update(conversations).set({ unreadStaff: 0 }).where(eq(conversations.id, c.id));
  res.json({ conversation: c, messages: msgs });
});
adminCommsRouter.post('/conversations/:id/reply', async (req, res) => {
  const { body } = z.object({ body: z.string().min(1).max(8000) }).parse(req.body);
  const [c] = await db.select().from(conversations).where(eq(conversations.id, req.params.id)).limit(1);
  if (!c) throw new AppError(404, 'not_found', 'Conversation not found');
  await db.insert(conversationMessages).values({ conversationId: c.id, authorRole: 'staff', authorId: req.auth!.sub, body: body.trim() });
  await db.update(conversations).set({ lastMessageAt: new Date(), unreadUser: c.unreadUser + 1, status: 'open' }).where(eq(conversations.id, c.id));
  // Website visitors have no in-app inbox — email them the reply if we have their address.
  if (c.source === 'website' && c.email) {
    await sendEmail(c.email, `Re: ${c.subject || 'your message to Vaulmo'}`, `<p>${body.trim().replace(/\n/g, '<br>')}</p><p style="color:#5b6b85;font-size:12px">— The Vaulmo team</p>`);
  }
  await audit({ action: 'comms.conversation.reply', actorId: req.auth!.sub, targetType: 'conversation', targetId: c.id, req });
  res.status(201).json({ ok: true });
});
adminCommsRouter.post('/conversations/:id/close', async (req, res) => {
  await db.update(conversations).set({ status: 'closed' }).where(eq(conversations.id, req.params.id));
  await audit({ action: 'comms.conversation.closed', actorId: req.auth!.sub, targetId: req.params.id, req });
  res.json({ ok: true });
});
