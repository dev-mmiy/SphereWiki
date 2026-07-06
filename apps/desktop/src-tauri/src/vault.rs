//! Workspace-scoped filesystem commands backing the on-disk `.md` vault (M2b.3). The TS
//! `createFileBackedVault` core (in @spherewiki/shared) drives these via a Tauri-`invoke` `FsPort`;
//! all note identity / slug / byte-preservation logic stays in TS, so Rust hosts ONLY file IO,
//! scoped to one directory per workspace (project isolation by construction — a command can never
//! touch a path outside its workspace vault dir).

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

/// A workspace id may only be `[A-Za-z0-9_-]+` — an ALLOW-LIST (not a denylist), so it can never be
/// a path component that escapes or collapses the per-workspace scope (`.`, `..`, separators, `\0`,
/// etc. are all excluded by construction). Rust is the isolation boundary and must not trust the
/// frontend (webview script can invoke any command with arbitrary args).
fn valid_workspace(id: &str) -> bool {
  !id.is_empty()
    && id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The vault directory for a workspace: `<app-data-dir>/vaults/<workspace>`.
fn vault_root(app: &tauri::AppHandle, workspace: &str) -> Result<PathBuf, String> {
  if !valid_workspace(workspace) {
    return Err(format!("invalid workspace id: {workspace:?}"));
  }
  let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
  Ok(base.join("vaults").join(workspace))
}

/// Reject a filename that isn't a single path component (defense in depth — the TS core already
/// emits safe slugs, but Rust never trusts the frontend with a path).
fn safe_name(name: &str) -> Result<(), String> {
  if name.is_empty()
    || name == "."
    || name == ".."
    || name.contains('/')
    || name.contains('\\')
    || name.contains('\0')
  {
    return Err(format!("invalid file name: {name:?}"));
  }
  Ok(())
}

/// List the top-level entry names in the workspace vault dir (empty if it doesn't exist yet). The
/// TS core filters to `*.md` and skips dot-entries, so returning everything here is fine.
#[tauri::command]
pub fn vault_list_files(app: tauri::AppHandle, workspace: String) -> Result<Vec<String>, String> {
  let root = vault_root(&app, &workspace)?;
  if !root.exists() {
    return Ok(Vec::new());
  }
  let mut names = Vec::new();
  for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    if let Some(name) = entry.file_name().to_str() {
      names.push(name.to_string());
    }
  }
  Ok(names)
}

/// Read a note file's UTF-8 content verbatim.
#[tauri::command]
pub fn vault_read_file(
  app: tauri::AppHandle,
  workspace: String,
  name: String,
) -> Result<String, String> {
  safe_name(&name)?;
  let path = vault_root(&app, &workspace)?.join(&name);
  fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write a note file atomically (temp + fsync + rename) so a crash never truncates the source of
/// truth. The temp name is dot-prefixed and `.tmp`-suffixed, so a concurrent `list` skips it.
#[tauri::command]
pub fn vault_write_file(
  app: tauri::AppHandle,
  workspace: String,
  name: String,
  content: String,
) -> Result<(), String> {
  safe_name(&name)?;
  let root = vault_root(&app, &workspace)?;
  fs::create_dir_all(&root).map_err(|e| e.to_string())?;
  let tmp = root.join(format!(".{name}.tmp"));
  let path = root.join(&name);
  {
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
  }
  fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Move/rename a note file within the workspace vault dir.
#[tauri::command]
pub fn vault_rename_file(
  app: tauri::AppHandle,
  workspace: String,
  from: String,
  to: String,
) -> Result<(), String> {
  safe_name(&from)?;
  safe_name(&to)?;
  let root = vault_root(&app, &workspace)?;
  fs::rename(root.join(&from), root.join(&to)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::{safe_name, valid_workspace};

  #[test]
  fn workspace_allowlist_rejects_path_components_and_traversal() {
    for ok in ["ws-dev", "ws_1", "WorkspaceA", "0", "a-b_c"] {
      assert!(valid_workspace(ok), "{ok} should be accepted");
    }
    // The exact scope-collapse the review found (".") plus every other escape must be rejected.
    for bad in ["", ".", "..", "...", "a/b", "a\\b", "a b", "a.b", "café", "a\0b", "vaults/.."] {
      assert!(!valid_workspace(bad), "{bad:?} should be rejected");
    }
  }

  #[test]
  fn safe_name_rejects_separators_and_dot_components() {
    for ok in ["Home.md", "Getting Started.md", "メモ.md", "a-b_c.md"] {
      assert!(safe_name(ok).is_ok(), "{ok} should be accepted");
    }
    for bad in ["", ".", "..", "a/b.md", "a\\b.md", "a\0b.md"] {
      assert!(safe_name(bad).is_err(), "{bad:?} should be rejected");
    }
  }
}
