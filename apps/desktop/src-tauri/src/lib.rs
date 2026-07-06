/// A trivial IPC command proving the frontend <-> Rust bridge works. The real vault / DuckDB
/// commands (M2b.3+) register here the same way, each allow-listed in `capabilities/`.
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
    .invoke_handler(tauri::generate_handler![ping])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
