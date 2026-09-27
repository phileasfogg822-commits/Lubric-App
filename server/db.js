import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'lubricapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Test connection
pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

export async function getClient() {
  return pool.connect();
}

export default pool;
