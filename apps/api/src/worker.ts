import { runReminderTick } from './lib/reminderEngine';
import { processDueCampaigns } from './modules/crm/campaigns.routes';
import { logger } from './logger';
import { pool } from './db/client';

// Standalone reminder worker. Run this as a scheduled job / long-lived worker so the
// engine fires on an interval instead of relying on a manual API call.
//   - one-shot (cron):   npx tsx src/worker.ts --once
//   - loop (worker):     npx tsx src/worker.ts   (ticks every INTERVAL_MS)
const INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS ?? 3600_000); // default hourly
const once = process.argv.includes('--once');

async function tick() {
  try {
    const r = await runReminderTick(new Date());
    logger.info({ ...r }, 'reminder tick complete');
  } catch (err) {
    logger.error({ err }, 'reminder tick failed');
  }
  try {
    const c = await processDueCampaigns(new Date());
    if (c.sent) logger.info({ ...c }, 'scheduled campaigns tick complete');
  } catch (err) {
    logger.error({ err }, 'scheduled campaigns tick failed');
  }
}

async function main() {
  await tick();
  if (once) { await pool.end(); process.exit(0); }
  setInterval(tick, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, 'reminder worker running');
}
main();
