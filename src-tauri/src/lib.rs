// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#[cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Run migration on startup
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = handle;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
