//! The SQLite pool behind the webview's queries (batch 6, 2026-11-25).
//!
//! tauri-plugin-sql opens a database with `Pool::connect`, a sqlx pool of up
//! to ten connections, and runs every `execute` or `select` of the webview as
//! a fresh acquire from it. sqlx gives a connection back to its pool through
//! a spawned task: when the next statement arrives before that task ran, the
//! pool finds no idle connection, opens a second one, and from then on serves
//! the two in turn. A sale driven from TypeScript (`dbTransaction`,
//! `src/lib/db.ts`) is then split: its `BEGIN` and a first write on one
//! connection, later writes on others — each auto-committing — and `COMMIT`
//! on yet another, a no-op there. A failure mid-sale leaves the earlier
//! writes committed (stock down, no order — reported 2026-11-25), the
//! `ROLLBACK` lands on a connection with no transaction, and the stranded
//! transaction holds a write lock until the app restarts (517) while the
//! next `BEGIN` on it fails with "cannot start a transaction within a
//! transaction". The FIFO lock of `db.ts` orders the statements; it cannot
//! choose their connection.
//!
//! `use_single_connection_pool` closes that gap: right after `Database.load`,
//! before any statement, it replaces the plugin's pool by a pool of ONE
//! connection on the same database, so every statement runs on that
//! connection, whatever the timing. It relies on `DbInstances` and `DbPool`,
//! public but undocumented parts of tauri-plugin-sql (2.4.0, `RwLock` —
//! verified on docs.rs for that exact version): a bump of the plugin or of
//! sqlx re-checks them.

use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

/// Options of the pool that replaces the plugin's: one connection, which sqlx
/// never closes on its own. With its defaults, sqlx closes a connection idle
/// for 10 minutes, or older than 30 minutes when it comes back to the pool:
/// closed between two statements of a transaction, the connection would cut
/// it as surely as a second one.
pub(crate) fn single_connection_pool_options() -> SqlitePoolOptions {
    SqlitePoolOptions::new()
        .max_connections(1)
        .idle_timeout(None)
        .max_lifetime(None)
}

/// Replace the pool stored under `db` in `instances` by a pool of one
/// connection on the same database, then close the replaced pool. On a
/// refusal or a failure, `instances` is left as it was.
pub(crate) async fn swap_in_single_connection_pool(
    instances: &DbInstances,
    db: &str,
) -> Result<(), String> {
    // Held while the new pool opens: no statement of the webview reaches
    // either pool between the read of the plugin's options and the swap.
    let mut pools = instances.0.write().await;

    // `Sqlite` is the only variant with the plugin's `sqlite` feature, the
    // only one this app enables: if the plugin's enum changes, this line stops
    // compiling, and the switch is re-checked.
    let DbPool::Sqlite(current) = pools
        .get(db)
        .ok_or_else(|| format!("database_not_loaded: {db}"))?;

    // A pool closed by the plugin's `close` stays in its map: reopening it
    // here would bring back a database the app has closed.
    if current.is_closed() {
        return Err(format!("database_closed: {db}"));
    }

    // The plugin's own options: same file, same pragmas (5 s busy timeout,
    // foreign keys on), without resolving the path a second time.
    let options = current.connect_options().as_ref().clone();

    let single: SqlitePool = single_connection_pool_options()
        .connect_with(options)
        .await
        .map_err(|e| format!("single_connection_pool_failed: {e}"))?;

    let replaced = pools.insert(db.to_string(), DbPool::Sqlite(single));

    drop(pools);

    if let Some(DbPool::Sqlite(replaced)) = replaced {
        replaced.close().await;
    }

    Ok(())
}

/// Replace the pool tauri-plugin-sql opened for `db`, the `sqlite:` URL given
/// to `Database.load`, by a pool of one connection on the same database, then
/// close the plugin's pool. `getLocal` (`src/lib/db.ts`) calls it right
/// after `Database.load`, before any statement, and logs (but does not fail
/// the open) when it fails — the app must keep working on the plugin's pool
/// rather than brick the till. Errors: `database_not_loaded: <db>`,
/// `database_closed: <db>`, or `single_connection_pool_failed: <sqlx error>`;
/// in all three, the plugin's pool stays where it was.
#[tauri::command]
pub async fn use_single_connection_pool(
    db_instances: State<'_, DbInstances>,
    db: String,
) -> Result<(), String> {
    swap_in_single_connection_pool(&db_instances, &db).await
}
