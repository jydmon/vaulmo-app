import type { Config } from 'drizzle-kit';

// drizzle-kit config. `db:migrate` uses the lightweight runner in src/db/migrate.ts,
// but this config lets you also use `drizzle-kit generate`/`studio` in dev.
export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://lifehub:devpassword@127.0.0.1:5433/lifehub_dev',
  },
} satisfies Config;
