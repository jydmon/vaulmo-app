import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { corsOrigins } from './env';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFound } from './middleware/error';
import { authRouter } from './modules/auth/auth.routes';
import { mfaRouter } from './modules/mfa/mfa.routes';
import { usersRouter } from './modules/users/users.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { supportRouter, adminSupportRouter } from './modules/support/support.routes';
import { cmsRouter } from './modules/cms/cms.routes';
import { filesRouter } from './modules/files/files.routes';
import { vaultRouter } from './modules/vault/vault.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { assistantRouter } from './modules/assistant/assistant.routes';
import { billingRouter } from './modules/billing/billing.routes';
import { stripeWebhookRouter } from './modules/billing/webhook.routes';
import { familyRouter, nokPublicRouter } from './modules/family/family.routes';
import { emergencyRouter, emergencyPublicRouter } from './modules/emergency/emergency.routes';
import { integrationsRouter, integrationsWebhookRouter } from './modules/integrations/integrations.routes';
import { lifeRouter } from './modules/life/life.routes';
import { healthRouter } from './modules/health/health.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // No public exposure in Phase 1: allow same-process/no-origin (mobile, curl)
        // and the explicit internal dev origins only.
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  // Health/monitoring is unauthenticated and un-throttled (probes hit it constantly).
  app.use('/', healthRouter);

  // Everything under /api/v1 is rate-limited. express.json only parses
  // application/json bodies, so binary file uploads (handled by a raw() route
  // inside filesRouter) pass through untouched.
  app.use('/api/v1', apiLimiter);
  // Stripe webhook needs the RAW body → mount before the JSON parser.
  app.use('/api/v1/stripe', stripeWebhookRouter);
  app.use('/api/v1', express.json({ limit: '1mb' }));
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/mfa', mfaRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/support', supportRouter);
  app.use('/api/v1/admin/support', adminSupportRouter);
  app.use('/api/v1/cms', cmsRouter);
  app.use('/api/v1/files', filesRouter);
  app.use('/api/v1/vault', vaultRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/assistant', assistantRouter);
  app.use('/api/v1/billing', billingRouter);
  app.use('/api/v1/family', familyRouter);
  app.use('/api/v1/nok', nokPublicRouter);
  app.use('/api/v1/emergency', emergencyPublicRouter);
  app.use('/api/v1/emergency', emergencyRouter);
  app.use('/api/v1/integrations', integrationsRouter);
  app.use('/api/v1/integrations-webhook', integrationsWebhookRouter);
  app.use('/api/v1', lifeRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
