import pino from 'pino';
import { env } from './env';

// Structured JSON logging. Ships to stdout; a log shipper (e.g. Loki, CloudWatch,
// Datadog) collects it per environment. Never logs secrets or tokens.
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'mfaSecret',
      '*.password',
      '*.token',
    ],
    remove: true,
  },
  base: { service: 'lifehub-api', env: env.APP_ENV },
});
