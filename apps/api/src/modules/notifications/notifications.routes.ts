import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { notifications, notificationSettings, deviceTokens, reminders } from '../../db/schema';
import { requireAuth, requireMfaSatisfied } from '../../middleware/auth';
import { requireInternalTester } from '../../middleware/internalTester';
import { requirePermission } from '../../middleware/rbac';
import { PERMISSIONS } from '../../lib/permissions';
import { AppError } from '../../middleware/error';
import { audit } from '../../lib/audit';
import { runReminderTick } from '../../lib/reminderEngine';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireMfaSatisfied, requireInternalTester);

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

// Channel preferences.
notificationsRouter.get('/settings', async (req, res) => {
  const [s] = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, req.auth!.sub)).limit(1);
  res.json(s ?? { userId: req.auth!.sub, inApp: true, email: true, push: true });
});
const prefSchema = z.object({ inApp: z.boolean().optional(), email: z.boolean().optional(), push: z.boolean().optional() });
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
