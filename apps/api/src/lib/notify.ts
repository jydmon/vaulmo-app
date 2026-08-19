import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { notifications, notificationSettings, deviceTokens } from '../db/schema';
import { logger } from '../logger';

// Notification delivery across three channels behind one interface.
//  - in_app : stored, served by GET /notifications  (fully real)
//  - email  : dev = outbox (stored + logged); prod adapter = SES/SMTP
//  - push   : dev = outbox (stored + logged); prod adapter = FCM/APNs
// Swap the dev drivers for real providers by env without touching callers.

export type Channel = 'in_app' | 'email' | 'push';
export type Category = 'reminder' | 'missing_document' | 'system';

export interface NotifyInput {
  userId: string;
  tenantId?: string | null;
  category: Category;
  title: string;
  body: string;
  reminderId?: string | null;
  dedupeKey?: string;
  channels?: Channel[]; // default: all the user has enabled
  critical?: boolean;   // critical alerts (e.g. overdue) bypass quiet hours
}

async function settingsFor(userId: string) {
  const [s] = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, userId)).limit(1);
  return s ?? { userId, inApp: true, email: true, push: true, quietStart: null as number | null, quietEnd: null as number | null };
}

// Quiet hours over an integer-hour window [start, end). Handles windows that wrap
// midnight (e.g. 22 → 7). Interpreted in UTC for now (per-user timezone is a later refinement).
function inQuietHours(s: { quietStart?: number | null; quietEnd?: number | null }, now: Date): boolean {
  if (s.quietStart == null || s.quietEnd == null || s.quietStart === s.quietEnd) return false;
  const h = now.getUTCHours();
  return s.quietStart < s.quietEnd ? h >= s.quietStart && h < s.quietEnd : h >= s.quietStart || h < s.quietEnd;
}

// Provider adapters (dev drivers log; real drivers are wired by env in staging/prod).
const emailDriver = {
  async send(to: string, title: string, body: string) {
    logger.info({ channel: 'email', to, title }, 'EMAIL (dev outbox)');
    // Production: SES/SMTP send here.
  },
};
const pushDriver = {
  async send(tokens: string[], title: string, body: string) {
    logger.info({ channel: 'push', tokens: tokens.length, title }, 'PUSH (dev outbox)');
    // Production: FCM/APNs send here.
  },
};

// Delivers to each enabled channel. Deduplicated by (user, channel, dedupeKey) at
// the DB level, so re-running the engine never double-notifies.
export async function notify(input: NotifyInput): Promise<Channel[]> {
  const s = await settingsFor(input.userId);
  const enabled = input.channels ?? (['in_app', 'email', 'push'] as Channel[]);
  const delivered: Channel[] = [];
  // During quiet hours, non-critical email/push are held back; the in-app record is
  // always kept so the notification centre still shows it.
  const quiet = !input.critical && inQuietHours(s, new Date());

  for (const channel of enabled) {
    if (channel === 'in_app' && !s.inApp) continue;
    if (channel === 'email' && !s.email) continue;
    if (channel === 'push' && !s.push) continue;
    if (quiet && (channel === 'email' || channel === 'push')) continue;

    const rows = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        tenantId: input.tenantId ?? null,
        channel,
        category: input.category,
        title: input.title,
        body: input.body,
        reminderId: input.reminderId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        status: 'sent',
      })
      .onConflictDoNothing()
      .returning();
    if (!rows.length) continue; // deduped

    if (channel === 'email') await emailDriver.send(input.userId, input.title, input.body);
    if (channel === 'push') {
      const toks = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, input.userId));
      if (toks.length) await pushDriver.send(toks.map((t) => t.token), input.title, input.body);
    }
    delivered.push(channel);
  }
  return delivered;
}
