/**
 * Capacitor SQLite driver for the main app's local (offline) mode.
 *
 * db.ts speaks to its local database through a small shape — select() returns
 * rows, execute() reports rowsAffected — which the Tauri desktop build
 * satisfies with @tauri-apps/plugin-sql. The phone build has no Tauri runtime,
 * so this module satisfies the same shape with @capacitor-community/sqlite
 * (the dependency the field app already proves in mobile/src/store.ts).
 *
 * Two translations happen here, because the app writes Postgres-style SQL:
 *  - `$1, $2, ...` placeholders become `?` (positional order preserved).
 *    SQLite itself accepts `$1`, but the plugin's run/query take `?` values,
 *    and translating keeps every driver on the same contract.
 *  - Multi-statement strings (the LOCAL_SCHEMA / OUTBOX_SCHEMA DDL blocks)
 *    are split and run one statement at a time.
 * Both steps are quote-aware: `$` and `;` inside '...' string literals (and
 * "..." identifiers) are left alone.
 *
 * The plugin itself is imported lazily by openCapDb() only — never at module
 * top level — so the web/desktop bundle never pulls native plugin code in.
 * createCapDb() takes any connection object with the plugin's query/run
 * methods, which is what makes it unit-testable without a device.
 */

export interface CapSqliteConn {
  query: (statement: string, values?: unknown[]) => Promise<{ values?: unknown[] }>;
  // transaction: pass false to run a statement bare. The plugin wraps
  // every run() in its own transaction by default (transaction = true),
  // which is why this parameter exists at all — see createCapDb below.
  run: (statement: string, values?: unknown[], transaction?: boolean) => Promise<{ changes?: { changes?: number } }>;
}

/**
 * Split SQL on top-level semicolons and rewrite $n placeholders to `?`.
 * Returns the non-empty statements, in order.
 *
 * Quote-aware (a `;` or `$` inside '...' or "..." is data, not syntax)
 * AND trigger-aware: the `;` inside a CREATE TRIGGER ... BEGIN ... END
 * block does not end the statement — only the `;` after END does. Without
 * this, a trigger body is cut in half and SQLite reports "incomplete
 * input" (caught 2026-10-31 by the customer-save simulation, before it
 * could reach a phone).
 */
export function prepareStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let single = false;
  let dbl = false;
  let beginDepth = 0;
  let word = "";
  const flushWord = () => {
    const w = word.toUpperCase();
    if (w === "BEGIN") beginDepth++;
    else if (w === "END" && beginDepth > 0) beginDepth--;
    word = "";
  };
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (single) {
      cur += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { cur += sql[i + 1]; i++; } else { single = false; }
      }
      continue;
    }
    if (dbl) {
      cur += ch;
      if (ch === '"') {
        if (sql[i + 1] === '"') { cur += sql[i + 1]; i++; } else { dbl = false; }
      }
      continue;
    }
    if (/[A-Za-z]/.test(ch)) { word += ch; cur += ch; continue; }
    flushWord();
    if (ch === "'") { single = true; cur += ch; continue; }
    if (ch === '"') { dbl = true; cur += ch; continue; }
    if (ch === "$" && /[0-9]/.test(sql[i + 1] ?? "")) {
      // Skip the digits, emit one positional placeholder.
      while (i + 1 < sql.length && /[0-9]/.test(sql[i + 1])) i++;
      cur += "?";
      continue;
    }
    if (ch === ";" && beginDepth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  flushWord();
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Normalize one bound value for the plugin's binder. The Android plugin
 * binds through androidx SimpleSQLiteQuery, which only accepts null,
 * String, Number and byte[] — a JS boolean or a JSON object/array has no
 * binding and the statement dies with "Run: ..." (caught 2026-11-10 on
 * the tablet's first sync: the pull carries order_items booleans
 * leftover_released/billed_by_capacity and inspections.inspection_data,
 * a JSONB object, so every sync failed at the first such row and the
 * cursor was never saved). SQLite stores booleans as 0/1 integers anyway
 * — the local schema declares those columns INTEGER, and the read side
 * already treats them as boolean|number (priceMemory.ts) — and JSON
 * values belong in TEXT columns as strings, so normalizing here loses
 * nothing: true/false become 1/0, objects/arrays become their JSON text.
 */
export function normalizeBindValue(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

export interface LocalDbHandle {
  select: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  execute: (sql: string, params?: unknown[]) => Promise<{ rowsAffected: number; rows: unknown[] }>;
}

export function createCapDb(conn: CapSqliteConn): LocalDbHandle {
  return {
    async select(sql: string, params: unknown[] = []): Promise<unknown[]> {
      const stmts = prepareStatements(sql);
      const res = await conn.query(stmts[0], params.map(normalizeBindValue));
      return (res.values ?? []) as unknown[];
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; rows: unknown[] }> {
      const stmts = prepareStatements(sql);
      const values = params.map(normalizeBindValue);
      let affected = 0;
      // Every run goes through with transaction = false. The plugin wraps
      // each run() in its own transaction unless told otherwise, and the
      // app issues its own transaction boundaries: dbTransaction sends
      // literal BEGIN / COMMIT / ROLLBACK around a sale (and ledger, expense
      // and product writes). A BEGIN sent inside the plugin's implicit
      // transaction dies with "cannot start a transaction within a
      // transaction" (caught 2026-11-11 on the tablet's first Complete
      // Sale), so the boundaries must reach SQLite bare. Single statements
      // lose nothing by this: SQLite autocommits them, which is exactly
      // what the plugin's per-statement wrapper did for them.
      if (stmts.length === 1) {
        const r = await conn.run(stmts[0], values, false);
        affected = r.changes?.changes ?? 0;
      } else {
        // Schema/DDL blocks carry no params; run each statement in order.
        for (const s of stmts) {
          const r = await conn.run(s, [], false);
          affected += r.changes?.changes ?? 0;
        }
      }
      return { rowsAffected: affected, rows: [] };
    },
  };
}

let capHandle: LocalDbHandle | null = null;

/** Open (once) the phone's local database and return the db.ts handle. */
export async function openCapDb(): Promise<LocalDbHandle> {
  if (capHandle) return capHandle;
  const mod: any = await import("@capacitor-community/sqlite");
  const sqlite = new mod.SQLiteConnection(mod.CapacitorSQLite);
  const conn = await sqlite.createConnection("lubric", false, "no-encryption", 1, false);
  await conn.open();
  capHandle = createCapDb(conn);
  return capHandle;
}
