import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client';
import { supportTickets, supportMessages, tenants, users } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';

async function messagesFor(ticketIds: string[]) {
  if (!ticketIds.length) return new Map<string, any[]>();
  const rows = await db.select().from(supportMessages).where(inArray(supportMessages.ticketId, ticketIds)).orderBy(supportMessages.createdAt);
  const m = new Map<string, any[]>();
  for (const r of rows) m.set(r.ticketId, [...(m.get(r.ticketId) ?? []), r]);
  return m;
}

// ================= Customer support (any authenticated tenant user) =================
export const supportRouter = Router();
supportRouter.use(requireAuth, requireMfaSatisfied);
const tid = (req: any): string => {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only customer accounts can raise tickets');
  return req.auth.tid;
};

const newTicketSchema = z.object({ subject: z.string().min(1).max(200), category: z.string().optional(), priority: z.enum(['low', 'normal', 'high']).optional(), body: z.string().min(1) });
supportRouter.post('/tickets', async (req, res) => {
  const b = newTicketSchema.parse(req.body);
  const [t] = await db.insert(supportTickets).values({ tenantId: tid(req), userId: req.auth!.sub, subject: b.subject, category: b.category, priority: b.priority ?? 'normal', status: 'open' }).returning();
  await db.insert(supportMessages).values({ ticketId: t.id, authorId: req.auth!.sub, authorRole: 'customer', body: b.body });
  await audit({ action: 'support.ticket.created', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'ticket', targetId: t.id, req });
  res.status(201).json({ ticket: t });
});

supportRouter.get('/tickets', async (req, res) => {
  const rows = await db.select().from(supportTickets).where(eq(supportTickets.tenantId, tid(req))).orderBy(desc(supportTickets.updatedAt));
  const msgs = await messagesFor(rows.map((r) => r.id));
  res.json({ tickets: rows.map((t) => ({ ...t, messageCount: (msgs.get(t.id) ?? []).length, lastMessage: (msgs.get(t.id) ?? []).slice(-1)[0] ?? null })) });
});

supportRouter.get('/tickets/:id', async (req, res) => {
  const [t] = await db.select().from(supportTickets).where(and(eq(supportTickets.id, req.params.id), eq(supportTickets.tenantId, tid(req)))).limit(1);
  if (!t) throw new AppError(404, 'not_found', 'Ticket not found');
  const messages = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id)).orderBy(supportMessages.createdAt);
  res.json({ ticket: t, messages });
});

supportRouter.post('/tickets/:id/messages', async (req, res) => {
  const body = z.object({ body: z.string().min(1) }).parse(req.body);
  const [t] = await db.select().from(supportTickets).where(and(eq(supportTickets.id, req.params.id), eq(supportTickets.tenantId, tid(req)))).limit(1);
  if (!t) throw new AppError(404, 'not_found', 'Ticket not found');
  const [m] = await db.insert(supportMessages).values({ ticketId: t.id, authorId: req.auth!.sub, authorRole: 'customer', body: body.body }).returning();
  // A customer reply reopens a closed ticket and marks it awaiting support.
  await db.update(supportTickets).set({ status: 'open', updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
  res.status(201).json({ message: m });
});

// ================= Super Admin support console =================
export const adminSupportRouter = Router();
adminSupportRouter.use(requireAuth, requireMfaSatisfied, requirePermission(PERMISSIONS.PLATFORM_MANAGE));

adminSupportRouter.get('/tickets', async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const where = status ? eq(supportTickets.status, status) : undefined;
  const rows = await db.select().from(supportTickets).where(where as any).orderBy(desc(supportTickets.updatedAt));
  const tRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const uRows = await db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users);
  const tName = new Map(tRows.map((t) => [t.id, t.name]));
  const uInfo = new Map(uRows.map((u) => [u.id, u]));
  const msgs = await messagesFor(rows.map((r) => r.id));
  const counts = { open: 0, pending: 0, closed: 0 } as Record<string, number>;
  const all = await db.select({ status: supportTickets.status }).from(supportTickets);
  for (const a of all) counts[a.status] = (counts[a.status] ?? 0) + 1;
  res.json({
    tickets: rows.map((t) => ({
      ...t,
      customer: t.tenantId ? tName.get(t.tenantId) ?? 'Unknown' : '—',
      requester: t.userId ? uInfo.get(t.userId)?.email ?? null : null,
      messageCount: (msgs.get(t.id) ?? []).length,
      lastMessage: (msgs.get(t.id) ?? []).slice(-1)[0] ?? null,
    })),
    counts,
  });
});

adminSupportRouter.get('/tickets/:id', async (req, res) => {
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.id)).limit(1);
  if (!t) throw new AppError(404, 'not_found', 'Ticket not found');
  const messages = await db.select().from(supportMessages).where(eq(supportMessages.ticketId, t.id)).orderBy(supportMessages.createdAt);
  const [tenant] = t.tenantId ? await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, t.tenantId)).limit(1) : [null as any];
  const [u] = t.userId ? await db.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, t.userId)).limit(1) : [null as any];
  res.json({ ticket: { ...t, customer: tenant?.name ?? '—', requester: u ?? null }, messages });
});

adminSupportRouter.post('/tickets/:id/messages', async (req, res) => {
  const body = z.object({ body: z.string().min(1) }).parse(req.body);
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.id)).limit(1);
  if (!t) throw new AppError(404, 'not_found', 'Ticket not found');
  const [m] = await db.insert(supportMessages).values({ ticketId: t.id, authorId: req.auth!.sub, authorRole: 'support', body: body.body }).returning();
  // A support reply moves the ticket to 'pending' (awaiting the customer).
  await db.update(supportTickets).set({ status: 'pending', updatedAt: new Date() }).where(eq(supportTickets.id, t.id));
  await audit({ action: 'support.ticket.replied', actorId: req.auth!.sub, targetType: 'ticket', targetId: t.id, req });
  res.status(201).json({ message: m });
});

adminSupportRouter.post('/tickets/:id/status', async (req, res) => {
  const body = z.object({ status: z.enum(['open', 'pending', 'closed']) }).parse(req.body);
  const [t] = await db.update(supportTickets).set({ status: body.status, updatedAt: new Date() }).where(eq(supportTickets.id, req.params.id)).returning();
  if (!t) throw new AppError(404, 'not_found', 'Ticket not found');
  await audit({ action: 'support.ticket.status', actorId: req.auth!.sub, targetType: 'ticket', targetId: t.id, metadata: { status: body.status }, req });
  res.json({ ticket: t });
});
