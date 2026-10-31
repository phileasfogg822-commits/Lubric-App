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
  run: (statement: string, values?: unknown[]) => Promise<{ changes?: { changes?: number } }>;
}

/**
 * Split SQL on top-level semicolons and rewrite $n placeholders to `?`.
 * Returns the non-empty statements, in order.
 */
export function prepareStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let single = false;
  let dbl = false;
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
    if (ch === "'") { single = true; cur += ch; continue; }
    if (ch === '"') { dbl = true; cur += ch; continue; }
    if (ch === "$" && /[0-9]/.test(sql[i + 1] ?? "")) {
      // Skip the digits, emit one positional placeholder.
      while (i + 1 < sql.length && /[0-9]/.test(sql[i + 1])) i++;
      cur += "?";
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export interface LocalDbHandle {
  select: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  execute: (sql: string, params?: unknown[]) => Promise<{ rowsAffected: number; rows: unknown[] }>;
}

export function createCapDb(conn: CapSqliteConn): LocalDbHandle {
  return {
    async select(sql: string, params: unknown[] = []): Promise<unknown[]> {
      const stmts = prepareStatements(sql);
      const res = await conn.query(stmts[0], params);
      return (res.values ?? []) as unknown[];
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number; rows: unknown[] }> {
      const stmts = prepareStatements(sql);
      let affected = 0;
      if (stmts.length === 1) {
        const r = await conn.run(stmts[0], params);
        affected = r.changes?.changes ?? 0;
      } else {
        // Schema/DDL blocks carry no params; run each statement in order.
        for (const s of stmts) {
          const r = await conn.run(s, []);
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
