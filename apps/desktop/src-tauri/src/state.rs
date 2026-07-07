//! Per-workspace NON-derived durable state (O3): version history, session prefs, AI metrics — the
//! primary state that CANNOT be rebuilt from Markdown (unlike the vector/FTS indexes). Stored as one
//! `<vault>/.spherewiki/state.json` so it travels with the `.md` folder (copy / git-sync the vault
//! and "every edit is versioned & revertible" survives). A `Storage`-shaped TS adapter hydrates from
//! `state_load` at boot and writes through via `state_save`.

use crate::vault::vault_root;
use std::fs;
use std::io::Write;

fn state_path(app: &tauri::AppHandle, workspace: &str) -> Result<std::path::PathBuf, String> {
  Ok(vault_root(app, workspace)?.join(".spherewiki").join("state.json"))
}

/// The stored JSON blob (`{}` when there is none yet). Parsed by the TS adapter into its mirror.
#[tauri::command]
pub fn state_load(app: tauri::AppHandle, workspace: String) -> Result<String, String> {
  let path = state_path(&app, &workspace)?;
  match fs::read_to_string(&path) {
    Ok(content) => Ok(content),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
    Err(e) => Err(e.to_string()),
  }
}

/// Persist the whole state blob atomically (temp + fsync + rename).
#[tauri::command]
pub fn state_save(app: tauri::AppHandle, workspace: String, content: String) -> Result<(), String> {
  let path = state_path(&app, &workspace)?;
  let dir = path.parent().ok_or("bad state path")?;
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  let tmp = dir.join(".state.json.tmp");
  {
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
  }
  fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
