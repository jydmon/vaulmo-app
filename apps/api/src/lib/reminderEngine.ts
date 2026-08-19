import { and, eq, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { reminders, documents, tenants, users, nextOfKin } from '../db/schema';
import { recommendedForCountry } from './catalogue';
import { notify } from './notify';

// The Reminder Engine. A scheduler (cron / worker) calls runReminderTick() on an
// interval (e.g. hourly). It is idempotent: notifications are deduped, and each
// reminder only fires once per escalation threshold it crosses.

function daysUntil(dueISO: string, now: Date): number {
  const due = new Date(dueISO + 'T00:00:00Z').getTime();
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((due - today) / 86400000);
}

// Escalation level = how many lead thresholds have been reached (higher = more urgent).
// leadDays e.g. [30,7,1,0]: level 1 at ≤30d, 2 at ≤7d, 3 at ≤1d, 4 at due/overdue.
function targetEscalation(dueISO: string, leadDays: number[], now: Date): number {
  const d = daysUntil(dueISO, now);
  const sorted = [...leadDays].sort((a, b) => b - a); // descending
  let level = 0;
  for (const lead of sorted) if (d <= lead) level += 1;
  return level;
}

function urgency(d: number): string {
  if (d < 0) return `overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}`;
  if (d === 0) return 'due today';
  return `due in ${d} day${d === 1 ? '' : 's'}`;
}

export interface TickResult {
  processed: number;
  notified: number;
  missingDocNotifications: number;
  nokReconfirmations: number;
}

export async function runReminderTick(now = new Date()): Promise<TickResult> {
  let notified = 0;
  let processed = 0;

  // 1) Due-date reminders (ACTIVE, not snoozed).
  const active = await db.select().from(reminders).where(eq(reminders.status, 'ACTIVE'));
  for (const r of active) {
    processed++;
    if (!r.dueDate) continue;
    if (r.snoozedUntil && r.snoozedUntil.getTime() > now.getTime()) continue; // snoozed

    const target = targetEscalation(r.dueDate, r.leadDays, now);
    if (target <= r.escalationLevel) continue; // already notified at this urgency

    // Notify the tenant's members (owner). Recipients = users in the tenant.
    const recipients = await db.select().from(users).where(eq(users.tenantId, r.tenantId));
    const d = daysUntil(r.dueDate, now);
    for (const u of recipients) {
      const delivered = await notify({
        userId: u.id,
        tenantId: r.tenantId,
        category: 'reminder',
        title: r.title,
        body: `${r.title} — ${urgency(d)} (${r.dueDate}).`,
        reminderId: r.id,
        dedupeKey: `reminder:${r.id}:lvl${target}`,
        critical: d <= 0, // due/overdue items reach the user even during quiet hours
      });
      if (delivered.length) notified++;
    }
    await db.update(reminders).set({ escalationLevel: target, lastNotifiedAt: now }).where(eq(reminders.id, r.id));
  }

  // 2) Missing-document reminders (weekly, deduped by ISO week).
  const missingDocNotifications = await runMissingDocReminders(now);

  // 3) Quarterly next-of-kin reconfirmation reminders (Phase 7).
  const nokReconfirmations = await runNokReconfirmations(now);

  return { processed, notified, missingDocNotifications, nokReconfirmations };
}

// Nudge owners to reconfirm each next of kin every quarter.
export async function runNokReconfirmations(now = new Date()): Promise<number> {
  let count = 0;
  const week = isoWeek(now);
  const due = await db.select().from(nextOfKin).where(and(eq(nextOfKin.status, 'confirmed'), lt(nextOfKin.reconfirmDueAt, now)));
  for (const nok of due) {
    const recipients = await db.select().from(users).where(eq(users.tenantId, nok.tenantId));
    for (const u of recipients) {
      const delivered = await notify({
        userId: u.id, tenantId: nok.tenantId, category: 'system',
        title: 'Please reconfirm your next of kin',
        body: `It's time to reconfirm ${nok.name} as your next of kin (quarterly check).`,
        dedupeKey: `nok-reconfirm:${nok.id}:${week}`, channels: ['in_app', 'email'],
      });
      if (delivered.length) count++;
    }
  }
  return count;
}

function isoWeek(now: Date): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export async function runMissingDocReminders(now = new Date()): Promise<number> {
  let count = 0;
  const week = isoWeek(now);
  // Missing-document reminders now run for every tenant (user phase — no longer pilot-only).
  const allTenants = await db
    .select({ tenantId: tenants.id, country: tenants.country })
    .from(tenants);

  for (const t of allTenants) {
    if (!t.tenantId) continue;
    const recommended = recommendedForCountry(t.country ?? 'GB');
    const docs = await db.select().from(documents).where(and(eq(documents.tenantId, t.tenantId), isNull(documents.deletedAt)));
    const present = new Set(docs.map((d) => d.typeKey ?? d.classifiedTypeKey).filter(Boolean) as string[]);
    const missing = recommended.filter((rt) => !present.has(rt.key));
    if (!missing.length) continue;

    const recipients = await db.select().from(users).where(eq(users.tenantId, t.tenantId));
    for (const u of recipients) {
      const delivered = await notify({
        userId: u.id,
        tenantId: t.tenantId,
        category: 'missing_document',
        title: `${missing.length} recommended document${missing.length === 1 ? '' : 's'} still missing`,
        body: `Still to add: ${missing.map((m) => m.name).join(', ')}.`,
        dedupeKey: `missingdocs:${t.tenantId}:${week}`,
        channels: ['in_app', 'email'],
      });
      if (delivered.length) count++;
    }
  }
  return count;
}
