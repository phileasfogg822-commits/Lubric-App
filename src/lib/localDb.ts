/**
 * Local (offline) SQLite support for the desktop app.
 *
 * When the desktop runs in Tauri without a reachable shop server, the app
 * operates on a local SQLite database (via tauri-plugin-sql). The schema below
 * is the SQLite port of server/migrations (kept in sync with it). Sync to the
 * VPS is handled separately by src/lib/sync.ts.
 */

// Consolidated local schema, part 1 of 2 (SQLite dialect).
export const LOCAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS shops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT 'Zafar Lubricants', address TEXT DEFAULT '', phone TEXT DEFAULT '', currency TEXT DEFAULT 'PKR', language TEXT DEFAULT 'en', used_oil_drum_capacity REAL DEFAULT 200, manual_price_allowed INTEGER DEFAULT 0, wholesale_mode TEXT DEFAULT 'auto', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cashier', permissions TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS role_permissions (role TEXT NOT NULL, permission_key TEXT NOT NULL, PRIMARY KEY(role, permission_key));
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS brands (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, sku TEXT, barcode TEXT, name TEXT NOT NULL, brand_id INTEGER, category_id INTEGER, packing TEXT DEFAULT '', unit TEXT DEFAULT 'piece', variant TEXT DEFAULT '', mfd_date TEXT DEFAULT '', exp_date TEXT DEFAULT '', offer TEXT DEFAULT '', cost_price REAL DEFAULT 0, stock_qty REAL DEFAULT 0, low_stock_threshold REAL DEFAULT 5, price_returning REAL DEFAULT 0, price_walking REAL, price_wholesale REAL DEFAULT 0, wholesale_min_qty REAL DEFAULT 10, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, name TEXT NOT NULL, price REAL DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS containers (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, product_id INTEGER NOT NULL, barcode TEXT, original_volume REAL NOT NULL, remaining_volume REAL NOT NULL, status TEXT DEFAULT 'opened', opened_at TEXT DEFAULT (datetime('now')), source_order_id INTEGER);
CREATE TABLE IF NOT EXISTS container_splits (id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL, sold_qty REAL NOT NULL, sold_at TEXT DEFAULT (datetime('now')), order_id INTEGER);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, name TEXT NOT NULL, phone TEXT DEFAULT '', customer_type TEXT DEFAULT 'returning', credit_balance REAL DEFAULT 0, last_visit_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, registration TEXT NOT NULL, make TEXT DEFAULT '', model TEXT DEFAULT '', model_year TEXT DEFAULT '', color TEXT DEFAULT '', "condition" TEXT DEFAULT '', oil_capacity REAL DEFAULT 0, mileage INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS vendors (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, name TEXT NOT NULL, contact TEXT DEFAULT '', phone TEXT DEFAULT '', payable_balance REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS vendor_payables (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor_id INTEGER NOT NULL, amount REAL DEFAULT 0, due_date TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, name TEXT NOT NULL, type TEXT DEFAULT 'cash', balance REAL DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
`;
// Part 2 of 2.
export const LOCAL_SCHEMA_2 = `
CREATE TABLE IF NOT EXISTS account_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, amount REAL NOT NULL, type TEXT DEFAULT 'in', reference TEXT DEFAULT '', related_account_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, customer_id INTEGER, user_id INTEGER NOT NULL, total REAL DEFAULT 0, paid_amount REAL DEFAULT 0, payment_account_id INTEGER, payment_method TEXT DEFAULT 'cash', status TEXT DEFAULT 'completed', vehicle_id INTEGER, mileage INTEGER DEFAULT 0, notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, product_name TEXT DEFAULT '', qty REAL DEFAULT 1, unit_price REAL DEFAULT 0, line_total REAL DEFAULT 0, container_id INTEGER);
CREATE TABLE IF NOT EXISTS used_oil_drum (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, current_litres REAL DEFAULT 0, capacity REAL DEFAULT 200);
CREATE TABLE IF NOT EXISTS used_oil_log (id INTEGER PRIMARY KEY AUTOINCREMENT, drum_id INTEGER NOT NULL, litres REAL NOT NULL, type TEXT DEFAULT 'added', source_order_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, category TEXT NOT NULL, subcategory TEXT DEFAULT '', amount REAL DEFAULT 0, account_id INTEGER, date TEXT, note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, vendor_id INTEGER, total REAL DEFAULT 0, paid REAL DEFAULT 0, status TEXT DEFAULT 'completed', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS purchase_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_name TEXT DEFAULT '', qty REAL DEFAULT 0, unit_cost REAL DEFAULT 0, line_total REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, kind TEXT DEFAULT 'todo', title TEXT NOT NULL, details TEXT DEFAULT '', due_at TEXT, due_km INTEGER, last_mileage INTEGER, customer_id INTEGER, vehicle_id INTEGER, vendor_id INTEGER, order_id INTEGER, priority TEXT DEFAULT 'normal', recurrence_days INTEGER, status TEXT DEFAULT 'pending', completed_at TEXT, created_by_user_id INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE IF NOT EXISTS inspections (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER DEFAULT 1, customer_id INTEGER, vehicle_id INTEGER, data TEXT DEFAULT '', notes TEXT DEFAULT '', user_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
`;

// Part 3: the khata (migration 014). Append-only money history — balances,
// statements and trends are all derived from these rows, never stored.
// CHECK constraints mirror server/migrations/014_party_ledger.sql so an
// offline device rejects the same writes the server would.
export const LOCAL_SCHEMA_3 = `
CREATE TABLE IF NOT EXISTS commitments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                TEXT UNIQUE NOT NULL,
  shop_id             INTEGER DEFAULT 1,
  party_type          TEXT NOT NULL DEFAULT 'customer' CHECK (party_type IN ('customer','vendor')),
  party_id            INTEGER,
  status              TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','converted','cancelled')),
  total               REAL DEFAULT 0,
  notes               TEXT DEFAULT '',
  taken_by_user_id    INTEGER,
  converted_order_id  INTEGER,
  occurred_at         TEXT DEFAULT (datetime('now')),
  origin              TEXT DEFAULT 'shop',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT
);
CREATE TABLE IF NOT EXISTS commitment_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT UNIQUE NOT NULL,
  commitment_id INTEGER NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product','service','partial_container','used_oil','other')),
  ref_id        INTEGER,
  product_name  TEXT DEFAULT '',
  qty           REAL DEFAULT 1,
  unit_price    REAL DEFAULT 0,
  line_total    REAL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS party_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid              TEXT UNIQUE NOT NULL,
  shop_id           INTEGER DEFAULT 1,
  party_type        TEXT NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id          INTEGER NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('opening','bill','payment','return','adjustment')),
  direction         TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount            REAL NOT NULL DEFAULT 0,
  order_id          INTEGER,
  vendor_payable_id INTEGER,
  cash_movement_id  INTEGER,
  commitment_id     INTEGER,
  note              TEXT DEFAULT '',
  occurred_at       TEXT DEFAULT (datetime('now')),
  origin            TEXT DEFAULT 'shop',
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_party ON party_ledger(shop_id, party_type, party_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ledger_updated ON party_ledger(shop_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_commitments_party ON commitments(shop_id, party_type, party_id, occurred_at);
-- How one payment was split across the invoices it settled (migration 017).
CREATE TABLE IF NOT EXISTS payable_allocations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id           INTEGER DEFAULT 1,
  payment_uuid      TEXT NOT NULL,
  vendor_payable_id INTEGER NOT NULL,
  amount            REAL NOT NULL DEFAULT 0,
  created_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alloc_payable ON payable_allocations(vendor_payable_id);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON payable_allocations(payment_uuid);
`;

const LOCAL_SEED = `
INSERT OR IGNORE INTO shops (id, name, currency) VALUES (1, 'Zafar Lubricants', 'PKR');
INSERT OR IGNORE INTO accounts (id, name, type) VALUES (1, 'Shop Cash Drawer', 'cash');
INSERT OR IGNORE INTO accounts (id, name, type) VALUES (2, 'Bank Account', 'bank');
INSERT OR IGNORE INTO used_oil_drum (id, capacity) VALUES (1, 200);
INSERT OR IGNORE INTO settings (key, value) VALUES ('used_oil_drum_capacity', '200');
`;

let schemaReady: Promise<void> | null = null;

/** Translate the app's PostgreSQL-flavoured SQL into SQLite. */
export function pgToSqlite(sql: string): string {
  return sql
    // ::casts — SQLite stores TEXT dates/numbers, lexicographic ISO compares fine.
    .replace(/::(date|text|numeric|double\s+precision|integer|real|timestamp)(\(\d+\))?/gi, "")
    // date_trunc('day', col) → date(col); month/week via SQLite date modifiers.
    .replace(/\bdate_trunc\(\s*'day'\s*,\s*([^)]+?)\s*\)/gi, "date($1)")
    .replace(/\bdate_trunc\(\s*'month'\s*,\s*([^)]+?)\s*\)/gi, "date($1, 'start of month')")
    .replace(/\bdate_trunc\(\s*'week'\s*,\s*([^)]+?)\s*\)/gi, "date($1, 'weekday 0', '-6 days')")
    .replace(/\bNOW\(\s*\)/gi, "datetime('now')")
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/\bTRUE\b/gi, "1")
    .replace(/\bFALSE\b/gi, "0");
}

// Part 4: field data (server/migrations/019_field_activity.sql).
//
// `cash_movements` and `reservations` are in the desktop sync agent's table
// list, but this schema never created them - so pulling field data in local
// (offline) mode failed with "no such table" before it could store a single
// row. Mirrors the server columns, uuid UNIQUE because the pull upserts on it.
//
// customer_name is here because the field app records WHO was collected from
// and the server previously had nowhere to put it.
export const LOCAL_SCHEMA_4 = `
CREATE TABLE IF NOT EXISTS cash_movements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT UNIQUE,
  shop_id            INTEGER DEFAULT 1,
  kind               TEXT NOT NULL,
  amount             REAL DEFAULT 0,
  customer_id        INTEGER,
  customer_name      TEXT,
  customer_uuid      TEXT,
  vendor_id          INTEGER,
  order_id           INTEGER,
  account_id         INTEGER,
  taken_by_user_id   INTEGER,
  taken_by_device_id INTEGER,
  posted_at          TEXT,
  note               TEXT DEFAULT '',
  occurred_at        TEXT,
  origin             TEXT DEFAULT 'shop',
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cashmov_occurred ON cash_movements(occurred_at DESC);

CREATE TABLE IF NOT EXISTS reservations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid                TEXT UNIQUE,
  shop_id             INTEGER DEFAULT 1,
  customer_id         INTEGER,
  customer_name       TEXT,
  items_json          TEXT DEFAULT '[]',
  amount              REAL DEFAULT 0,
  status              TEXT DEFAULT 'open',
  fulfilled_order_id  INTEGER,
  created_by_user_id  INTEGER,
  note                TEXT DEFAULT '',
  origin              TEXT DEFAULT 'shop',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_reserv_status ON reservations(status);
`;

/**
 * Columns the sync layer needs that this schema predates: 012_sync added uuid,
 * shop_id and updated_at to every replicated table, but an existing local
 * database keeps the table it was created with — CREATE TABLE IF NOT EXISTS
 * never alters it. SQLite has no "ADD COLUMN IF NOT EXISTS", so check first.
 *
 * Only the tables the khata writes are patched. Recording a vendor payment
 * settles an invoice, and without updated_at the settled row would never
 * replicate; the other tables are left for the day local sync is switched on.
 */
const SYNC_COLUMN_PATCHES: { table: string; column: string; decl: string }[] = [
  { table: "vendor_payables", column: "uuid", decl: "TEXT" },
  { table: "vendor_payables", column: "shop_id", decl: "INTEGER DEFAULT 1" },
  { table: "vendor_payables", column: "updated_at", decl: "TEXT" },
];

async function patchSyncColumns(db: { select: (s: string) => Promise<unknown>; execute: (s: string) => Promise<unknown> }): Promise<void> {
  for (const p of SYNC_COLUMN_PATCHES) {
    const cols = (await db.select(`PRAGMA table_info(${p.table})`)) as { name: string }[] | null;
    if (!Array.isArray(cols) || cols.length === 0) continue; // table absent
    if (cols.some((c) => c.name === p.column)) continue; // already there
    await db.execute(`ALTER TABLE ${p.table} ADD COLUMN ${p.column} ${p.decl}`);
  }
}

/** Run the local schema + seed once per app session (idempotent DDL). */
export function ensureLocalSchema(db: { execute: (s: string) => Promise<unknown>; select: (s: string) => Promise<unknown> }): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(LOCAL_SCHEMA);
      await db.execute(LOCAL_SCHEMA_2);
      await db.execute(LOCAL_SCHEMA_3);
      await db.execute(LOCAL_SCHEMA_4);
      await db.execute(LOCAL_SEED);
      // Columns first, then the index that depends on them.
      await patchSyncColumns(db);
      await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payables_uuid ON vendor_payables(uuid)"
      );
    })().catch((e) => {
      schemaReady = null; // allow retry on next query
      throw e;
    });
  }
  return schemaReady;
}
