import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
import { env } from '../env';

const { Client } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal, dependency-free migration runner. Applies every *.sql file in
// ./migrations in filename order, exactly once, tracked in _migrations.
async function run() {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (done.rowCount) {
      console.log(`· skip ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`✗ failed ${file}`);
      throw e;
    }
  }
  await client.end();
  console.log('Migrations up to date.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
