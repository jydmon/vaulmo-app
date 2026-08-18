import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, tenants, sessions } from '../../db/schema';
import { isNull } from 'drizzle-orm';
import { env } from '../../env';

export const healthRouter = Router();

// Liveness — is the process up?
healthRouter.get('/livez', (_req, res) => {
  res.json({ status: 'ok', env: env.APP_ENV, uptime: process.uptime() });
});

// Readiness — can it serve traffic (DB reachable)?
healthRouter.get('/readyz', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ready', db: 'up' });
  } catch {
    res.status(503).json({ status: 'not_ready', db: 'down' });
  }
});

// Minimal Prometheus-style metrics for monitoring scrape.
healthRouter.get('/metrics', async (_req, res) => {
  const [[u], [t], [s]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(users),
    db.select({ n: sql<number>`count(*)` }).from(tenants),
    db.select({ n: sql<number>`count(*)` }).from(sessions).where(isNull(sessions.revokedAt)),
  ]);
  res.type('text/plain').send(
    [
      '# HELP lifehub_users_total Total users',
      '# TYPE lifehub_users_total gauge',
      `lifehub_users_total ${Number(u.n)}`,
      '# HELP lifehub_tenants_total Total tenants',
      '# TYPE lifehub_tenants_total gauge',
      `lifehub_tenants_total ${Number(t.n)}`,
      '# HELP lifehub_active_sessions Active sessions',
      '# TYPE lifehub_active_sessions gauge',
      `lifehub_active_sessions ${Number(s.n)}`,
    ].join('\n'),
  );
});
