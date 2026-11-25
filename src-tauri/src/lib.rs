// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#[cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod db_pool;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        // One install, one running copy: a second launch hands off to the
        // window that is already open instead of starting a second database
        // writer against the same lubric.db file.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        // Batch 6 (2026-11-25): the sql plugin opens the database as a pool
        // of up to ten connections, which splits a JS-driven BEGIN..COMMIT
        // across them. use_single_connection_pool swaps that pool for one
        // connection right after Database.load (see db_pool.rs); the
        // frontend invokes it from getLocal(), and capabilities/default.json
        // grants it to the main window.
        .invoke_handler(tauri::generate_handler![db_pool::use_single_connection_pool])
        .setup(|_app| {
            // No startup work here: the frontend owns the local database —
            // getLocal() in src/lib/db.ts runs ensureLocalSchema (tables,
            // seed, outbox triggers) the first time the database is opened.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
