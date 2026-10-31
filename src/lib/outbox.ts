/**
 * The offline write hook: how a local change becomes a row the server can
 * apply later.
 *
 * Two halves, both driven from the app's own write path (never from each
 * mutation screen — there are dozens of them and a missed one silently
 * never syncs):
 *
 *  1. AFTER INSERT / UPDATE / DELETE triggers on every replicated table
 *     write into `sync_outbox` (table_name, row_uuid, op, payload). The
 *     payload is the full row as JSON, minus `id` — the server owns `id`
 *     and sanitises every other key against its own columns anyway.
 *     DELETE triggers exist only for the tables whose server row supports
 *     soft delete (see SOFT_DELETE_TABLES, mirroring server/index.js);
 *     deleting an append-only ledger row is rejected server-side, so
 *     queuing it would retry forever.
 *  2. `injectUuid` gives a local INSERT its uuid when the statement does
 *     not already carry one. SQLite has no gen_random_uuid() default, and
 *     a trigger can only queue rows whose uuid is NOT NULL — without this,
 *     every locally created row would be invisible to sync.
 *
 * The pull phase must NOT queue what it downloads, or every pulled row
 * echoes straight back up. syncNow drops these triggers before pulling
 * and recreates them afterwards (finally-blocked, so a crash mid-pull
 * still leaves them restored on the next launch's schema init).
 */

export interface OutboxDbHandle {
  // select returns rows; typed loosely because localDb's handle types it as
  // unknown (the PRAGMA result is cast at the use site).
  select: (sql: string, params?: unknown[]) => Promise<unknown>;
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/** Tables whose server row has a deleted_at column (server/index.js SYNC_TABLES meta). */
export const SOFT_DELETE_TABLES: ReadonlySet<string> = new Set([
  "products",
  "services",
  "customers",
  "vehicles",
  "vendors",
  "expenses",
]);

export type TriggerOp = "ins" | "upd" | "del";

export function triggerName(table: string, op: TriggerOp): string {
  return `trg_${table}_${op}`;
}

function jsonPairs(columns: string[], alias: "NEW" | "OLD"): string {
  return columns.map((c) => `'${c}', ${alias}.${c}`).join(", ");
}

/**
 * The CREATE TRIGGER statements for one table. `columns` are the table's
 * real columns (from PRAGMA table_info), minus `id`. Returns ins + upd,
 * plus del only for soft-delete tables. Empty string for a table with no
 * uuid column — it cannot be queued without an identity.
 */
export function buildTriggerSql(table: string, columns: string[]): string[] {
  if (!columns.includes("uuid")) return [];
  const cols = columns.filter((c) => c !== "id");
  const out: string[] = [
    `CREATE TRIGGER IF NOT EXISTS ${triggerName(table, "ins")} AFTER INSERT ON ${table} ` +
      `WHEN NEW.uuid IS NOT NULL BEGIN ` +
      `INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('${table}', NEW.uuid, 'insert', json_object(${jsonPairs(cols, "NEW")})); END;`,
    `CREATE TRIGGER IF NOT EXISTS ${triggerName(table, "upd")} AFTER UPDATE ON ${table} ` +
      `WHEN NEW.uuid IS NOT NULL BEGIN ` +
      `INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('${table}', NEW.uuid, 'update', json_object(${jsonPairs(cols, "NEW")})); END;`,
  ];
  if (SOFT_DELETE_TABLES.has(table)) {
    out.push(
      `CREATE TRIGGER IF NOT EXISTS ${triggerName(table, "del")} AFTER DELETE ON ${table} ` +
        `WHEN OLD.uuid IS NOT NULL BEGIN ` +
        `INSERT INTO sync_outbox (table_name, row_uuid, op, payload) VALUES ('${table}', OLD.uuid, 'delete', json_object(${jsonPairs(cols, "OLD")})); END;`
    );
  }
  return out;
}

export function dropTriggerSql(table: string): string[] {
  return (["ins", "upd", "del"] as TriggerOp[]).map(
    (op) => `DROP TRIGGER IF EXISTS ${triggerName(table, op)}`
  );
}

/** Create (or re-create, idempotently) the outbox triggers for every table that has a uuid column. */
export async function ensureOutboxTriggers(db: OutboxDbHandle, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    const info = (await db.select(`PRAGMA table_info(${table})`)) as { name: string }[] | null;
    if (!Array.isArray(info) || info.length === 0) continue; // table absent
    const columns = info.map((c) => c.name);
    for (const sql of buildTriggerSql(table, columns)) {
      await db.execute(sql);
    }
  }
}

export async function dropOutboxTriggers(db: OutboxDbHandle, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    for (const sql of dropTriggerSql(table)) {
      await db.execute(sql);
    }
  }
}

export function newUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  // Fallback (non-secure contexts): timestamp + randomness, UUID-shaped.
  const s = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s()}${s()}-${s()}-4${s().substring(1)}-${((Math.random() * 4) | 8).toString(16)}${s().substring(1)}-${s()}${s()}${s()}`;
}

/**
 * Rewrite a single-row INSERT so a replicated table's new row carries a
 * uuid. Returns { sql, params } with the uuid column + value appended, or
 * null when nothing should change: not an INSERT, table not replicated,
 * uuid already present, no explicit column list, or a multi-row VALUES
 * (the app's writes are single-row; refusing is safer than guessing).
 */
export function injectUuid(
  sql: string,
  params: unknown[],
  syncTables: readonly string[]
): { sql: string; params: unknown[] } | null {
  const m = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(sql);
  if (!m) return null;
  const table = m[1];
  if (!syncTables.includes(table)) return null;
  const cols = m[2].split(",").map((c) => c.trim().replace(/^["`[]|["`\]]$/g, ""));
  if (cols.some((c) => c.toLowerCase() === "uuid")) return null;

  // Find the VALUES (...) group, quote-aware, and confirm it is the only row.
  const valuesOpen = m.index + m[0].length - 1; // the '(' of VALUES (
  let depth = 0;
  let single = false;
  let dbl = false;
  let close = -1;
  for (let i = valuesOpen; i < sql.length; i++) {
    const ch = sql[i];
    if (single) {
      if (ch === "'") {
        if (sql[i + 1] === "'") i++;
        else single = false;
      }
      continue;
    }
    if (dbl) {
      if (ch === '"') {
        if (sql[i + 1] === '"') i++;
        else dbl = false;
      }
      continue;
    }
    if (ch === "'") { single = true; continue; }
    if (ch === '"') { dbl = true; continue; }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;
  const rest = sql.slice(close + 1).trim();
  if (rest.startsWith(",")) return null; // multi-row VALUES — refuse

  const colClose = sql.indexOf(")", m.index);
  const newSql =
    sql.slice(0, colClose) + ", uuid" + sql.slice(colClose, close) + ", ?" + sql.slice(close);
  return { sql: newSql, params: [...params, newUuid()] };
}
