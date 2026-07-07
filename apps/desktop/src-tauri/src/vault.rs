//! Workspace-scoped filesystem commands backing the on-disk `.md` vault (M2b.3). The TS
//! `createFileBackedVault` core (in @spherewiki/shared) drives these via a Tauri-`invoke` `FsPort`;
//! all note identity / slug / byte-preservation logic stays in TS, so Rust hosts ONLY file IO,
//! scoped to one directory per workspace (project isolation by construction — a command can never
//! touch a path outside its workspace vault dir). Note files may live in **subfolders** for
//! human-readable grouping, so paths are workspace-**root-relative** (e.g. `work/Foo.md`) and the
//! listing is recursive; every path is validated to stay within the root (no `..`, no absolute).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
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

/// The vault directory for a workspace: `<app-data-dir>/vaults/<workspace>`. `pub(crate)` so the
/// derived-index module (DuckDB) can scope its per-workspace `.duckdb` file under the same root.
pub(crate) fn vault_root(app: &tauri::AppHandle, workspace: &str) -> Result<PathBuf, String> {
  if !valid_workspace(workspace) {
    return Err(format!("invalid workspace id: {workspace:?}"));
  }
  let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
  Ok(base.join("vaults").join(workspace))
}

/// Validate a workspace-root-relative path: `/`-separated, no empty / `.` / `..` component, no
/// backslash or NUL, not absolute, and **no dot-prefixed component** — so `root.join(rel)` can never
/// escape the vault NOR reach a reserved sidecar. Rejecting a leading-`.` segment (not just exact
/// `.`/`..`) keeps a note command out of `.trash/` and `.spherewiki/` (state.json / index.duckdb):
/// symmetric with `walk_md`, which skips those, and correct since a real note path is never
/// dot-prefixed (the TS slug strips leading dots). Defense in depth — Rust never trusts the frontend.
fn safe_relpath(path: &str) -> Result<(), String> {
  let ok = !path.is_empty()
    && !path.starts_with('/')
    && !path.contains('\\')
    && !path.contains('\0')
    && path.split('/').all(|c| !c.is_empty() && !c.starts_with('.'));
  if !ok {
    return Err(format!("invalid relative path: {path:?}"));
  }
  Ok(())
}

/// Recursively collect `*.md` file paths under `dir`, relative to it, skipping dot-files and
/// dot-folders (`.trash/`, `.spherewiki/`) at any depth. `prefix` is the accumulated relative dir.
fn walk_md(dir: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), String> {
  for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let name = match entry.file_name().into_string() {
      Ok(n) => n,
      Err(_) => continue, // non-UTF-8 name — skip
    };
    if name.starts_with('.') {
      continue; // dot-file / dot-folder (.trash, .spherewiki, temp writes)
    }
    let rel = if prefix.is_empty() {
      name.clone()
    } else {
      format!("{prefix}/{name}")
    };
    let file_type = entry.file_type().map_err(|e| e.to_string())?;
    if file_type.is_dir() {
      walk_md(&entry.path(), &rel, out)?;
    } else if name.ends_with(".md") {
      out.push(rel);
    }
  }
  Ok(())
}

/// Write `content` to `path` atomically (temp in the same dir + fsync + rename), creating parent
/// dirs. The temp name is dot-prefixed + `.tmp`-suffixed, so a concurrent list/walk skips it.
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
  let parent = path.parent().ok_or("bad path")?;
  fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("bad path")?;
  let tmp = parent.join(format!(".{file_name}.tmp"));
  {
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
  }
  fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// All `*.md` note paths (workspace-root-relative, recursive), empty if the vault doesn't exist yet.
#[tauri::command]
pub fn vault_list_files(app: tauri::AppHandle, workspace: String) -> Result<Vec<String>, String> {
  let root = vault_root(&app, &workspace)?;
  let mut out = Vec::new();
  if root.exists() {
    walk_md(&root, "", &mut out)?;
  }
  Ok(out)
}

/// Read a note file's UTF-8 content verbatim (by its root-relative path).
#[tauri::command]
pub fn vault_read_file(
  app: tauri::AppHandle,
  workspace: String,
  path: String,
) -> Result<String, String> {
  safe_relpath(&path)?;
  fs::read_to_string(vault_root(&app, &workspace)?.join(&path)).map_err(|e| e.to_string())
}

/// Write a note file atomically (temp + fsync + rename, parent dirs created).
#[tauri::command]
pub fn vault_write_file(
  app: tauri::AppHandle,
  workspace: String,
  path: String,
  content: String,
) -> Result<(), String> {
  safe_relpath(&path)?;
  atomic_write(&vault_root(&app, &workspace)?.join(&path), &content)
}

/// Move/rename a note file within the workspace vault dir (both root-relative; parent of `to` created).
#[tauri::command]
pub fn vault_rename_file(
  app: tauri::AppHandle,
  workspace: String,
  from: String,
  to: String,
) -> Result<(), String> {
  safe_relpath(&from)?;
  safe_relpath(&to)?;
  let root = vault_root(&app, &workspace)?;
  let dest = root.join(&to);
  if let Some(parent) = dest.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::rename(root.join(&from), dest).map_err(|e| e.to_string())
}

/// Soft-delete on disk: move a note's `.md` into `.trash/`, **preserving its subpath** (so it can be
/// restored to the same folder). `.trash/` is dot-prefixed, so the `*.md` scan + `reindex` skip it
/// and `reindex` prunes the note's derived vector (O2).
#[tauri::command]
pub fn vault_trash_file(
  app: tauri::AppHandle,
  workspace: String,
  path: String,
) -> Result<(), String> {
  safe_relpath(&path)?;
  let root = vault_root(&app, &workspace)?;
  let dest = root.join(".trash").join(&path);
  if let Some(parent) = dest.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::rename(root.join(&path), dest).map_err(|e| e.to_string())
}

/// Restore a soft-deleted note: move it back out of `.trash/` to its original subpath.
#[tauri::command]
pub fn vault_untrash_file(
  app: tauri::AppHandle,
  workspace: String,
  path: String,
) -> Result<(), String> {
  safe_relpath(&path)?;
  let root = vault_root(&app, &workspace)?;
  let dest = root.join(&path);
  if let Some(parent) = dest.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::rename(root.join(".trash").join(&path), dest).map_err(|e| e.to_string())
}

/// The note paths currently in `.trash/` (root-relative to `.trash/`, recursive) — so the app can
/// load trashed bodies, kept restorable across a reload. Empty when there is no `.trash/` yet.
#[tauri::command]
pub fn vault_list_trash(app: tauri::AppHandle, workspace: String) -> Result<Vec<String>, String> {
  let trash = vault_root(&app, &workspace)?.join(".trash");
  let mut out = Vec::new();
  if trash.exists() {
    walk_md(&trash, "", &mut out)?;
  }
  Ok(out)
}

/// Read a trashed note file's content (verbatim UTF-8, by its `.trash/`-relative path).
#[tauri::command]
pub fn vault_read_trash(
  app: tauri::AppHandle,
  workspace: String,
  path: String,
) -> Result<String, String> {
  safe_relpath(&path)?;
  fs::read_to_string(vault_root(&app, &workspace)?.join(".trash").join(&path))
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::{safe_relpath, valid_workspace};

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
  fn safe_relpath_allows_subfolders_but_rejects_traversal() {
    for ok in ["Home.md", "Getting Started.md", "work/Meeting.md", "a/b/c/Deep.md", "メモ.md"] {
      assert!(safe_relpath(ok).is_ok(), "{ok} should be accepted");
    }
    // Traversal / absolute / separators-as-components / NUL — and any DOT-PREFIXED segment (so a
    // note command can never reach the reserved `.trash/` / `.spherewiki/` sidecars) — are rejected.
    for bad in [
      "", ".", "..", "/etc/passwd", "a/../b", "../x.md", "a//b.md", "a\\b.md", "a\0b", "work/",
      ".trash/x.md", ".spherewiki/state.json", "work/.hidden.md", ".config",
    ] {
      assert!(safe_relpath(bad).is_err(), "{bad:?} should be rejected");
    }
  }
}
