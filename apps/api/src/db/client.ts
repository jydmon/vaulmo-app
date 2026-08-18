import pkg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../env';
import * as schema from './schema';

const { Pool } = pkg;

// TLS to the database.
//  - Managed hosts that REQUIRE SSL (Neon, Supabase, Render external URL): set DATABASE_SSL=true.
//  - Render's INTERNAL connection string doesn't use SSL: leave DATABASE_SSL unset/false.
//  - Local dev: no SSL.
function dbSsl(): false | { rejectUnauthorized: boolean } | undefined {
  const mode = (process.env.DATABASE_SSL ?? '').toLowerCase();
  if (mode === 'true' || mode === 'require') return { rejectUnauthorized: false };
  if (mode === 'false' || mode === 'disable') return false;
  return env.APP_ENV === 'development' ? false : undefined;
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  ssl: dbSsl(),
});

export const db = drizzle(pool, { schema });
export { schema };
