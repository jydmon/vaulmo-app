import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { notifications, notificationSettings, deviceTokens, reminders } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { runReminderTick } from '../../lib/reminderEngine';

export const notificationsRouter = Router();
// In-app notifications are available to every authenticated user (the internal-tester
// gate was removed so the inbox, unread badge and preferences work platform-wide).
notificationsRouter.use(requireAuth, requireMfaSatisfied);

// Platform: run the reminder engine tick (a cron calls this in prod).
notificationsRouter.post('/run-tick', requirePermission(PERMISSIONS.PLATFORM_MANAGE), async (req, res) => {
  const result = await runReminderTick(new Date());
  await audit({ action: 'reminder.tick', actorId: req.auth!.sub, metadata: { ...result }, req });
  res.json(result);
});

// In-app inbox.
notificationsRouter.get('/', async (req, res) => {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, req.auth!.sub), eq(notifications.channel, 'in_app')))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
  res.json({ notifications: rows });
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, req.auth!.sub), eq(notifications.channel, 'in_app'), isNull(notifications.readAt)));
  res.json({ unread: Number(row.n) });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await db.update(notifications).set({ status: 'read', readAt: new Date() })
    .where(and(eq(notifications.userId, req.auth!.sub), isNull(notifications.readAt)));
  res.json({ ok: true });
});

// Channel preferences + quiet hours.
notificationsRouter.get('/settings', async (req, res) => {
  const [s] = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, req.auth!.sub)).limit(1);
  res.json(s ?? { userId: req.auth!.sub, inApp: true, email: true, push: true, quietStart: null, quietEnd: null });
});
const prefSchema = z.object({
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  push: z.boolean().optional(),
  quietStart: z.number().int().min(0).max(23).nullable().optional(),
  quietEnd: z.number().int().min(0).max(23).nullable().optional(),
});
notificationsRouter.put('/settings', async (req, res) => {
  const body = prefSchema.parse(req.body);
  const [existing] = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, req.auth!.sub)).limit(1);
  if (existing) {
    const [row] = await db.update(notificationSettings).set(body).where(eq(notificationSettings.userId, req.auth!.sub)).returning();
    res.json(row);
  } else {
    const [row] = await db.insert(notificationSettings).values({ userId: req.auth!.sub, ...body }).returning();
    res.json(row);
  }
});

// Register a push device.
const deviceSchema = z.object({ platform: z.enum(['ios', 'android', 'web']), token: z.string().min(8).max(400) });
notificationsRouter.post('/devices', async (req, res) => {
  const body = deviceSchema.parse(req.body);
  await db.insert(deviceTokens).values({ userId: req.auth!.sub, platform: body.platform, token: body.token }).onConflictDoNothing();
  res.status(201).json({ ok: true });
});

// Snooze a reminder (suppresses notifications until the snooze expires).
const snoozeSchema = z.object({ days: z.number().int().min(1).max(365).optional(), until: z.string().datetime().optional() });
notificationsRouter.post('/reminders/:id/snooze', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const body = snoozeSchema.parse(req.body);
  const until = body.until ? new Date(body.until) : new Date(Date.now() + (body.days ?? 7) * 86400000);
  const [r] = await db
    .update(reminders)
    .set({ snoozedUntil: until })
    .where(and(eq(reminders.id, req.params.id), eq(reminders.tenantId, req.auth!.tid ?? '')))
    .returning();
  if (!r) throw new AppError(404, 'not_found', 'Reminder not found');
  await audit({ action: 'reminder.snoozed', actorId: req.auth!.sub, tenantId: req.auth!.tid, targetType: 'reminder', targetId: r.id, metadata: { until }, req });
  res.json({ id: r.id, snoozedUntil: until });
});

// ---- Reminders: create custom, list, complete (REM-03/04/06) ----
const tid = (req: any): string => {
  if (!req.auth?.tid) throw new AppError(400, 'no_tenant', 'Only tenant accounts have reminders');
  return req.auth.tid;
};
const RECUR = ['none', 'monthly', 'quarterly', 'yearly'] as const;
// Roll an ISO date forward by one recurrence interval.
function nextDue(dateISO: string, recurrence: string): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  if (recurrence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (recurrence === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (recurrence === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// Create a user-defined reminder (custom dates/schedules + optional recurrence).
const createReminderSchema = z.object({
  title: z.string().min(1).max(160),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.string().max(40).optional(),
  recurrence: z.enum(RECUR).optional(),
  leadDays: z.array(z.number().int().min(0).max(3650)).max(6).optional(),
});
notificationsRouter.post('/reminders', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const b = createReminderSchema.parse(req.body);
  const [r] = await db.insert(reminders).values({
    tenantId: tid(req), documentId: null, kind: b.kind ?? 'custom', title: b.title, dueDate: b.dueDate,
    recurrence: b.recurrence ?? 'none', leadDays: b.leadDays, status: 'ACTIVE', source: 'user', activatedAt: new Date(),
  }).returning();
  await audit({ action: 'reminder.created', actorId: req.auth!.sub, tenantId: tid(req), targetType: 'reminder', targetId: r.id, req });
  res.status(201).json({ reminder: r });
});

// Notification centre view: overdue / upcoming / completed / snoozed.
notificationsRouter.get('/reminders', requirePermission(PERMISSIONS.FILE_READ), async (req, res) => {
  const all = await db.select().from(reminders).where(eq(reminders.tenantId, tid(req)));
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const isSnoozed = (r: any) => r.snoozedUntil && new Date(r.snoozedUntil).getTime() > now;
  const activeUnsnoozed = all.filter((r) => r.status === 'ACTIVE' && !isSnoozed(r));
  res.json({
    overdue: activeUnsnoozed.filter((r) => r.dueDate && r.dueDate < today),
    upcoming: activeUnsnoozed.filter((r) => !r.dueDate || r.dueDate >= today),
    snoozed: all.filter((r) => r.status === 'ACTIVE' && isSnoozed(r)),
    completed: all.filter((r) => r.status === 'COMPLETED'),
  });
});

// Mark a reminder complete — stops alerts; a recurring reminder spawns its next occurrence.
notificationsRouter.post('/reminders/:id/complete', requirePermission(PERMISSIONS.FILE_WRITE), async (req, res) => {
  const tenantId = tid(req);
  const [r] = await db.select().from(reminders).where(and(eq(reminders.id, req.params.id), eq(reminders.tenantId, tenantId))).limit(1);
  if (!r) throw new AppError(404, 'not_found', 'Reminder not found');
  await db.update(reminders).set({ status: 'COMPLETED', completedAt: new Date() }).where(eq(reminders.id, r.id));
  let next: any = null;
  if (r.recurrence && r.recurrence !== 'none' && r.dueDate) {
    [next] = await db.insert(reminders).values({
      tenantId, documentId: r.documentId, kind: r.kind, title: r.title, dueDate: nextDue(r.dueDate, r.recurrence),
      recurrence: r.recurrence, leadDays: r.leadDays, status: 'ACTIVE', source: r.source, activatedAt: new Date(),
    }).returning();
  }
  await audit({ action: 'reminder.completed', actorId: req.auth!.sub, tenantId, targetType: 'reminder', targetId: r.id, metadata: { recurrence: r.recurrence, nextId: next?.id ?? null }, req });
  res.json({ id: r.id, status: 'COMPLETED', nextOccurrence: next ? { id: next.id, dueDate: next.dueDate } : null });
});

// Mark one as read — kept last so it doesn't shadow the specific routes above.
notificationsRouter.post('/:id/read', async (req, res) => {
  const [row] = await db
    .update(notifications)
    .set({ status: 'read', readAt: new Date() })
    .where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.auth!.sub)))
    .returning();
  if (!row) throw new AppError(404, 'not_found', 'Notification not found');
  res.json({ ok: true });
});
