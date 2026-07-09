//! The PROJECT registry — the top-level list of local projects (= workspaces), stored ABOVE the
//! per-project vaults at `<app-data>/projects.json`. Each project has its own isolated
//! `vaults/<id>/` (Markdown + DuckDB index), so agents/RAG scoped to a project can never read
//! another's (isolation is by construction — the index is sealed to one `workspaceId`). This module
//! only reads/writes the registry blob; the TS side owns its shape (`{ projects, activeId }`).

use std::fs;
use std::io::Write;
use tauri::Manager;

fn registry_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("projects.json"))
}

/// The stored registry JSON (`{}` when there is none yet). Parsed by the TS registry into projects.
#[tauri::command]
pub fn projects_load(app: tauri::AppHandle) -> Result<String, String> {
  match fs::read_to_string(registry_path(&app)?) {
    Ok(content) => Ok(content),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
    Err(e) => Err(e.to_string()),
  }
}

/// Persist the whole registry blob atomically (temp + fsync + rename).
#[tauri::command]
pub fn projects_save(app: tauri::AppHandle, content: String) -> Result<(), String> {
  let path = registry_path(&app)?;
  let dir = path.parent().ok_or("bad registry path")?;
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  let tmp = dir.join(".projects.json.tmp");
  {
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
  }
  fs::rename(&tmp, &path).map_err(|e| e.to_string())
}
