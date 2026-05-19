import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: 'db.dxtbuiicrdkjxkwdjdwq.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: process.env.DB_PASS || '',
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS missing_items_log (
      id BIGSERIAL PRIMARY KEY,
      order_id INTEGER,
      item_uuid TEXT NOT NULL,
      item_name TEXT NOT NULL,
      order_date DATE NOT NULL,
      total_required INTEGER NOT NULL DEFAULT 1,
      qty_missing INTEGER NOT NULL DEFAULT 0,
      qty_made INTEGER NOT NULL DEFAULT 0,
      staff_id INTEGER,
      staff_name TEXT,
      reason_type TEXT NOT NULL DEFAULT 'other',
      reason_ingredient TEXT,
      reason_other TEXT,
      logged_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT
    );
    ALTER TABLE missing_items_log DISABLE ROW LEVEL SECURITY;
  `);
  console.log('OK');
  await client.end();
} catch (err) {
  console.error('Error:', err.message);
}
