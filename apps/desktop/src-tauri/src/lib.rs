mod duckdb_conformance;
mod vault;

/// A trivial IPC command proving the frontend <-> Rust bridge works. The real vault / DuckDB
/// commands register alongside it in the invoke handler.
#[tauri::command]
fn ping() -> String {
  // Logged (forwarded to stdout by tauri-plugin-log in debug) so the IPC round-trip is observable.
  log::info!("ipc ping received");
  "pong".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      ping,
      vault::vault_list_files,
      vault::vault_read_file,
      vault::vault_write_file,
      vault::vault_rename_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
