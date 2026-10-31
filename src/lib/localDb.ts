/**
 * Local (offline) SQLite support for the desktop app.
 *
 * When the desktop runs in Tauri without a reachable shop server, the app
 * operates on a local SQLite database (via tauri-plugin-sql). The schema below
 * is the SQLite port of server/migrations (kept in sync with it). Sync to the
 * VPS is handled separately by src/lib/sync.ts.
 */

import { SYNC_TABLES, ensureOutbox } from "./sync.ts";
import { ensureOutboxTriggers } from "./outbox.ts";
// NOTE: the .ts extensions above are deliberate. The repo's node-based tests
// import this module directly (see server/e2e_ledger_sqlite.js), and node ESM
// cannot resolve extensionless imports — dropping the extensions breaks
// those tests. Vite and tsc (allowImportingTsExtensions) accept them.

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
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, uuid TEXT, shop_id INTEGER DEFAULT 1, product_name TEXT DEFAULT '', qty REAL DEFAULT 1, unit_price REAL DEFAULT 0, line_total REAL DEFAULT 0, container_id INTEGER, capacity REAL DEFAULT 0, leftover_litres REAL DEFAULT 0, leftover_to TEXT DEFAULT 'customer', leftover_released INTEGER DEFAULT 0, billed_by_capacity INTEGER DEFAULT 0, updated_at TEXT);
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
  taken_by_name      TEXT,
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

// Part 5: the stock ledger (server/migrations/025_stock_ledger.sql).
//
// The local table exists for the same reason order_items was widened: the sync
// agent inserts every server column it is sent, so a missing column here does
// not degrade - it throws "no such column" and takes the whole pull with it.
//
// The cache/ledger split is preserved locally too: products.stock_qty stays the
// fast column, stock_movements is the append-only record behind it, and the two
// can be reconciled the same way.
export const LOCAL_SCHEMA_5 = `
CREATE TABLE IF NOT EXISTS stock_movements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid               TEXT UNIQUE,
  shop_id            INTEGER DEFAULT 1,
  item_id            INTEGER NOT NULL,
  kind               TEXT NOT NULL,
  qty                REAL NOT NULL,
  qty_after          REAL,
  ref_table          TEXT,
  ref_id             INTEGER,
  warehouse_id       INTEGER,
  note               TEXT DEFAULT '',
  occurred_at        TEXT,
  created_by_user_id INTEGER,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock_movements(shop_id, item_id, occurred_at);
`;

// Part 6: price lists (server/migrations/028_price_lists.sql).
//
// These must exist locally even though they are read-only here, because
// usePriceContext() queries them on every customer selection. A missing table
// does not degrade - it throws "no such table", the query rejects, and the POS
// loses its pricing for that customer. Exactly the failure order_items had.
export const LOCAL_SCHEMA_6 = `
CREATE TABLE IF NOT EXISTS price_lists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT UNIQUE,
  shop_id        INTEGER DEFAULT 1,
  name           TEXT NOT NULL,
  code           TEXT,
  is_default     INTEGER DEFAULT 0,
  markup_pct     REAL DEFAULT 0,
  rounding_mode  TEXT DEFAULT 'none',
  rounding_value REAL DEFAULT 0,
  active         INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT
);
CREATE TABLE IF NOT EXISTS price_list_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  price_list_id INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  price         REAL,
  min_qty       REAL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pli_list ON price_list_items(price_list_id, product_id);

CREATE TABLE IF NOT EXISTS party_price_lists (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       INTEGER DEFAULT 1,
  party_type    TEXT NOT NULL,
  party_id      INTEGER NOT NULL,
  price_list_id INTEGER NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ppl_party ON party_price_lists(party_type, party_id);

CREATE TABLE IF NOT EXISTS party_prices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER DEFAULT 1,
  party_type TEXT NOT NULL,
  party_id   INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  price      REAL NOT NULL,
  note       TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pp_party ON party_prices(party_type, party_id);
`;

// Part 7: customer groups (server/migrations/031_customer_groups.sql).
//
// usePriceContext() reads customer_groups on every customer selection, so a
// missing local table does not degrade - it throws "no such table" and the POS
// loses group pricing for that customer, silently falling back to normal price.
export const LOCAL_SCHEMA_7 = `
CREATE TABLE IF NOT EXISTS customer_groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid          TEXT UNIQUE,
  shop_id       INTEGER DEFAULT 1,
  name          TEXT NOT NULL,
  code          TEXT,
  price_tier    TEXT DEFAULT 'returning',
  price_list_id INTEGER,
  credit_days   INTEGER DEFAULT 0,
  credit_limit  REAL DEFAULT 0,
  colour        TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_groups_shop ON customer_groups(shop_id, active);
`;

// Part 8: units (server/migrations/032_units.sql).
//
// Additive only. products.packing and products.unit remain the source the POS
// actually reads, so a product with no unit_id still behaves exactly as before -
// the tables exist so units are CONFIGURED rather than reverse-engineered from a
// string, and so the next pack type needs a row rather than a new regex.
export const LOCAL_SCHEMA_8 = `
CREATE TABLE IF NOT EXISTS units (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid           TEXT UNIQUE,
  shop_id        INTEGER DEFAULT 1,
  name           TEXT NOT NULL,
  plural         TEXT,
  abbreviation   TEXT,
  dimension      TEXT DEFAULT 'count',
  decimal_places INTEGER DEFAULT 0,
  litres_each    REAL,
  active         INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT
);
CREATE TABLE IF NOT EXISTS unit_conversions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid         TEXT UNIQUE,
  from_unit_id INTEGER NOT NULL,
  to_unit_id   INTEGER NOT NULL,
  multiplier   REAL NOT NULL,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_unitconv_from ON unit_conversions(from_unit_id, to_unit_id);
`;

// Part 9: warehouses and locations (server/migrations/033_warehouses.sql).
//
// stock_movements gains warehouse_id and location_id, so the local table must
// grow those columns too or the sync INSERT fails on a whole pull. stock_levels
// is the per-warehouse cache, read by the stock screens.
export const LOCAL_SCHEMA_9 = `
CREATE TABLE IF NOT EXISTS warehouses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT UNIQUE,
  shop_id    INTEGER DEFAULT 1,
  name       TEXT NOT NULL,
  code       TEXT,
  address    TEXT,
  is_default INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS warehouse_locations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid         TEXT UNIQUE,
  warehouse_id INTEGER NOT NULL,
  shop_id      INTEGER DEFAULT 1,
  name         TEXT NOT NULL,
  code         TEXT,
  kind         TEXT DEFAULT 'rack',
  active       INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT
);
CREATE TABLE IF NOT EXISTS stock_levels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid         TEXT UNIQUE,
  shop_id      INTEGER DEFAULT 1,
  warehouse_id INTEGER NOT NULL,
  product_id   INTEGER NOT NULL,
  qty          REAL DEFAULT 0,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_levels_product ON stock_levels(product_id);
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
  // order_items: the sync agent inserts EVERY server column except id, so a
  // local table missing any of these does not degrade - it throws "no such
  // column" and takes the whole pull down with it. These arrived on the server
  // in stages (uuid/shop_id/updated_at in 012, the litre/leftover set with the
  // capacity-billing work) and the local table was never widened to match.
  { table: "order_items", column: "uuid", decl: "TEXT" },
  { table: "order_items", column: "shop_id", decl: "INTEGER DEFAULT 1" },
  { table: "order_items", column: "updated_at", decl: "TEXT" },
  { table: "order_items", column: "capacity", decl: "REAL DEFAULT 0" },
  { table: "order_items", column: "leftover_litres", decl: "REAL DEFAULT 0" },
  { table: "order_items", column: "leftover_to", decl: "TEXT DEFAULT 'customer'" },
  { table: "order_items", column: "leftover_released", decl: "INTEGER DEFAULT 0" },
  { table: "order_items", column: "billed_by_capacity", decl: "INTEGER DEFAULT 0" },
  // Columns added by later migrations, kept here rather than as raw ALTER
  // statements in ensureLocalSchema. The difference matters: a raw ALTER throws
  // "duplicate column name" on the SECOND app launch, the catch in
  // ensureLocalSchema rethrows, and offline mode never recovers. patchSyncColumns
  // checks PRAGMA table_info first, so it is a no-op the second time.
  { table: "customers", column: "group_id", decl: "INTEGER" },
  { table: "products", column: "unit_id", decl: "INTEGER" },
  // stock_movements grows the location dimension (migration 033).
  { table: "stock_movements", column: "warehouse_id", decl: "INTEGER" },
  { table: "stock_movements", column: "location_id", decl: "INTEGER" },
  // Phase 3.2 — every server column the pull sends but the local table
  // lacks. The pull inserts EVERY server column except id, so one missing
  // column throws "no such column" and takes the whole pull down. Measured
  // 2026-10-31 by diffing information_schema on the live database against
  // PRAGMA table_info after ensureLocalSchema (41 gaps, 13 tables).
  // Types are SQLite equivalents of the Postgres types.
  { table: "account_transactions", column: "uuid", decl: "TEXT" },
  { table: "account_transactions", column: "updated_at", decl: "TEXT" },
  { table: "account_transactions", column: "shop_id", decl: "INTEGER DEFAULT 1" },
  { table: "accounts", column: "uuid", decl: "TEXT" },
  { table: "accounts", column: "updated_at", decl: "TEXT" },
  { table: "accounts", column: "account_class", decl: "TEXT" },
  { table: "accounts", column: "code", decl: "TEXT" },
  { table: "customers", column: "uuid", decl: "TEXT" },
  { table: "customers", column: "updated_at", decl: "TEXT" },
  { table: "customers", column: "deleted_at", decl: "TEXT" },
  { table: "expenses", column: "uuid", decl: "TEXT" },
  { table: "expenses", column: "updated_at", decl: "TEXT" },
  { table: "expenses", column: "deleted_at", decl: "TEXT" },
  { table: "inspections", column: "order_id", decl: "INTEGER" },
  { table: "inspections", column: "inspection_data", decl: "TEXT" },
  { table: "inspections", column: "uuid", decl: "TEXT" },
  { table: "inspections", column: "updated_at", decl: "TEXT" },
  { table: "orders", column: "uuid", decl: "TEXT" },
  { table: "orders", column: "updated_at", decl: "TEXT" },
  { table: "orders", column: "converted_from_commitment_id", decl: "INTEGER" },
  { table: "products", column: "vendor_id", decl: "INTEGER" },
  { table: "products", column: "received_date", decl: "TEXT" },
  { table: "products", column: "uuid", decl: "TEXT" },
  { table: "products", column: "updated_at", decl: "TEXT" },
  { table: "products", column: "deleted_at", decl: "TEXT" },
  { table: "purchase_orders", column: "uuid", decl: "TEXT" },
  { table: "purchase_orders", column: "updated_at", decl: "TEXT" },
  { table: "reminders", column: "uuid", decl: "TEXT" },
  { table: "reservations", column: "taken_by_name", decl: "TEXT" },
  { table: "services", column: "uuid", decl: "TEXT" },
  { table: "services", column: "updated_at", decl: "TEXT" },
  { table: "services", column: "deleted_at", decl: "TEXT" },
  { table: "vehicles", column: "service_interval_days", decl: "INTEGER" },
  { table: "vehicles", column: "service_interval_km", decl: "INTEGER" },
  { table: "vehicles", column: "uuid", decl: "TEXT" },
  { table: "vehicles", column: "updated_at", decl: "TEXT" },
  { table: "vehicles", column: "deleted_at", decl: "TEXT" },
  { table: "vehicles", column: "shop_id", decl: "INTEGER DEFAULT 1" },
  { table: "vendors", column: "uuid", decl: "TEXT" },
  { table: "vendors", column: "updated_at", decl: "TEXT" },
  { table: "vendors", column: "deleted_at", decl: "TEXT" },
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
      await db.execute(LOCAL_SCHEMA_5);
      await db.execute(LOCAL_SCHEMA_6);
      // Every added column goes through patchSyncColumns below, never as a raw
      // ALTER: SQLite has no ADD COLUMN IF NOT EXISTS, a duplicate-column error
      // rethrows out of this catch, and offline mode never recovers on the next
      // launch. Customers.group_id and products.unit_id used to be raw ALTERs.
      await db.execute(LOCAL_SCHEMA_7);
      await db.execute(LOCAL_SCHEMA_8);
      await db.execute(LOCAL_SCHEMA_9);
      await db.execute(LOCAL_SEED);
      // Columns first, then the index that depends on them.
      await patchSyncColumns(db);
      await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payables_uuid ON vendor_payables(uuid)"
      );
      // The sync pull upserts on uuid, so the local table needs it UNIQUE -
      // without this, replaying the same rows raises a constraint error and the
      // offline replica silently stops accepting them.
      await db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_uuid ON order_items(uuid)"
      );
      // Phase 3.2: the tables that gained a uuid column above need the same
      // UNIQUE index, or their pull upserts can never match an existing row.
      for (const t of [
        "account_transactions",
        "accounts",
        "customers",
        "expenses",
        "inspections",
        "orders",
        "products",
        "purchase_orders",
        "reminders",
        "services",
        "vehicles",
        "vendors",
      ]) {
        await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_uuid ON ${t}(uuid)`);
      }
      // Outbox tables, then the triggers that fill them. The triggers are
      // created here (not only in syncNow) so a crash mid-pull — which drops
      // them — still leaves them restored on the next launch.
      await ensureOutbox(db);
      await ensureOutboxTriggers(db, SYNC_TABLES);
    })().catch((e) => {
      schemaReady = null; // allow retry on next query
      throw e;
    });
  }
  return schemaReady;
}
