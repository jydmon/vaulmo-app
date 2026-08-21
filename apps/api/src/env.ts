import 'dotenv/config';
import { z } from 'zod';

// Environment variables are always strings, and zod's boolean coercion applies
// JavaScript's Boolean() — which makes the literal string "false" evaluate to
// TRUE. That silently inverted SMTP_SECURE and broke TLS negotiation against
// port 587. Parse booleans explicitly instead.
const boolish = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return def;
    if (typeof v === 'boolean') return v;
    return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
  }, z.boolean());

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  ACCESS_TOKEN_TTL: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  MFA_ISSUER: z.string().default('Vaulmo'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
  // When true, unverified accounts cannot obtain a session (mandatory email
  // verification before login). Default off so dev/CI and existing tests are unaffected.
  REQUIRE_EMAIL_VERIFICATION: boolish(false),
  // Integrations (Connected Services) — real OAuth providers activate automatically
  // when these are present; otherwise the sandbox driver is used (internal-tester only).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default('common'),
  INTEGRATIONS_REDIRECT_URI: z.string().default('https://app.vaulmo.com/integrations/callback'),
  // Live email delivery (REM-09). When SMTP_HOST is set, transactional email is sent
  // over SMTP; otherwise it falls back to the dev outbox (logged, not sent).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: boolish(false),
  EMAIL_FROM: z.string().default('Vaulmo <no-reply@vaulmo.com>'),
  // Live push delivery (REM-08) via Expo Push. Optional token for higher rate limits.
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // Social sign-in (ACC-02). The public base URL of the web app, used to build OAuth
  // redirect URIs and to bounce the user back after provider login.
  APP_BASE_URL: z.string().default('https://app.vaulmo.com'),
  // Apple Sign in (optional; the client secret is a JWT generated from these).
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
