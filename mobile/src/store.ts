/**
 * Local store for the field app — Capacitor SQLite, offline-first.
 *
 * Tables:
 *  - cash_movements : what the field user records (collections, handovers).
 *  - reservations   : goods booked for a customer.
 *  - customers      : cached from the cloud (names, phone, credit balances).
 *  - outbox         : rows waiting to be pushed to /api/v1/push.
 *  - sync_state     : pull cursor.
 */

import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";

const sqlite = new SQLiteConnection(CapacitorSQLite);
let conn: SQLiteDBConnection | null = null;

export interface CashMovement {
  uuid: string;
  kind: "collection" | "handover" | "adjustment";
  amount: number;
  customer_name: string;
  note: string;
  occurred_at: string;
  synced: number;
}

export interface CustomerRow {
  uuid: string;
  name: string;
  phone: string;
  customer_type: string;
  credit_balance: number;
}

export interface ReservationRow {
  uuid: string;
  customer_name: string;
  items_json: string;
  amount: number;
  status: string;
  note: string;
  synced: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cash_movements (
  uuid TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  customer_name TEXT DEFAULT '',
  note TEXT DEFAULT '',
  occurred_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reservations (
  uuid TEXT PRIMARY KEY,
  customer_name TEXT DEFAULT '',
  items_json TEXT DEFAULT '[]',
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT DEFAULT '',
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customers (
  uuid TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  customer_type TEXT DEFAULT '',
  credit_balance REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_uuid TEXT NOT NULL,
  op TEXT NOT NULL DEFAULT 'insert',
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO sync_state (key, value) VALUES ('pull_cursor', '0');
`;

export async function db(): Promise<SQLiteDBConnection> {
  if (!conn) {
    conn = await sqlite.createConnection("lubricfield", false, "no-encryption", 1, false);
    await conn.open();
    await conn.execute(SCHEMA);
  }
  return conn;
}

export function newUuid(): string {
  return (crypto as any).randomUUID ? crypto.randomUUID() : `f-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function recordMovement(kind: CashMovement["kind"], amount: number, customerName: string, note: string): Promise<void> {
  const c = await db();
  const row: CashMovement = {
    uuid: newUuid(),
    kind,
    amount,
    customer_name: customerName,
    note,
    occurred_at: new Date().toISOString(),
    synced: 0,
  };
  await c.run(
    "INSERT INTO cash_movements (uuid, kind, amount, customer_name, note, occurred_at, synced) VALUES (?,?,?,?,?,?,0)",
    [row.uuid, row.kind, row.amount, row.customer_name, row.note, row.occurred_at]
  );
  await c.run("INSERT INTO outbox (table_name, row_uuid, op, payload) VALUES ('cash_movements', ?, 'insert', ?)", [
    row.uuid,
    JSON.stringify(row),
  ]);
}

export async function recordReservation(customerName: string, items: string, amount: number, note: string): Promise<void> {
  const c = await db();
  const uuid = newUuid();
  const row = { uuid, customer_name: customerName, items_json: JSON.stringify(items), amount, status: "open", note, synced: 0 };
  await c.run(
    "INSERT INTO reservations (uuid, customer_name, items_json, amount, status, note, synced) VALUES (?,?,?,?,?,?,0)",
    [uuid, customerName, JSON.stringify(items), amount, "open", note]
  );
  await c.run("INSERT INTO outbox (table_name, row_uuid, op, payload) VALUES ('reservations', ?, 'insert', ?)", [
    uuid,
    JSON.stringify(row),
  ]);
}

export async function pendingCount(): Promise<number> {
  const c = await db();
  const r = await c.query("SELECT COUNT(*) AS n FROM outbox");
  return Number((r.values?.[0] as any)?.n ?? 0);
}

export async function todayTotals(): Promise<{ collections: number; handovers: number; movements: CashMovement[] }> {
  const c = await db();
  const day = new Date().toISOString().slice(0, 10);
  const r = await c.query(
    "SELECT uuid, kind, amount, customer_name, note, occurred_at, synced FROM cash_movements WHERE occurred_at LIKE ? ORDER BY occurred_at DESC",
    [`${day}%`]
  );
  const movements = (r.values ?? []) as unknown as CashMovement[];
  const collections = movements.filter((m) => m.kind === "collection").reduce((s, m) => s + Number(m.amount), 0);
  const handovers = movements.filter((m) => m.kind === "handover").reduce((s, m) => s + Number(m.amount), 0);
  return { collections, handovers, movements };
}

export async function outstandingCustomers(): Promise<CustomerRow[]> {
  const c = await db();
  const r = await c.query(
    "SELECT uuid, name, phone, customer_type, credit_balance FROM customers WHERE credit_balance > 0 ORDER BY credit_balance DESC LIMIT 20"
  );
  return (r.values ?? []) as unknown as CustomerRow[];
}

export async function openReservations(): Promise<ReservationRow[]> {
  const c = await db();
  const r = await c.query("SELECT * FROM reservations WHERE status = 'open' ORDER BY rowid DESC LIMIT 50");
  return (r.values ?? []) as unknown as ReservationRow[];
}
