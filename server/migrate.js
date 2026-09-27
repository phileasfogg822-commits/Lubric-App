import { readdir, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  const migrationsDir = join(__dirname, 'migrations');
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files`);

  for (const file of files) {
    console.log(`Running migration: ${file}`);
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`  ✓ ${file} completed`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} failed:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('All migrations completed successfully');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
