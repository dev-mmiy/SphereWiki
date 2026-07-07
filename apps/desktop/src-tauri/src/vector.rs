//! The per-workspace DuckDB vector store (M2b.4). One `.duckdb` file per workspace under
//! `<vault>/.spherewiki/index.duckdb` → project isolation by construction (no command spans
//! workspaces). DuckDB is used purely as a durable key→record store here; the cosine ranking runs
//! in the TS mirror (Strategy A / D8 — brute-force, no VSS extension), so the vector is stored as a
//! JSON-array TEXT column (simple, exact) and all derive/scoring logic stays in TS (D3).

use crate::vault::vault_root;
use duckdb::Connection;
use serde::{Deserialize, Serialize};
use std::fs;

/// One stored embedding. Serialized `camelCase` so `vector_records`' return matches the TS
/// `EmbeddingRecord` shape (`noteId`/`contentHash`). `vector` crosses IPC as a JSON number array.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorRecord {
  pub note_id: String,
  pub title: String,
  pub vector: Vec<f64>,
  pub content_hash: String,
}

/// Open (creating if needed) the workspace's derived-index DB, ensuring the `vectors` table exists.
fn open_index(app: &tauri::AppHandle, workspace: &str) -> Result<Connection, String> {
  let dir = vault_root(app, workspace)?.join(".spherewiki");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let conn = Connection::open(dir.join("index.duckdb")).map_err(|e| e.to_string())?;
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS vectors(
         note_id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         vec TEXT NOT NULL,
         content_hash TEXT NOT NULL
       );",
    )
    .map_err(|e| e.to_string())?;
  Ok(conn)
}

/// Every stored record, ordered by `note_id` (a stable snapshot — feeds the TS mirror + idempotency).
#[tauri::command]
pub fn vector_records(
  app: tauri::AppHandle,
  workspace: String,
) -> Result<Vec<VectorRecord>, String> {
  let conn = open_index(&app, &workspace)?;
  let mut stmt = conn
    .prepare("SELECT note_id, title, vec, content_hash FROM vectors ORDER BY note_id")
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |row| {
      let vec_json: String = row.get(2)?;
      Ok(VectorRecord {
        note_id: row.get(0)?,
        title: row.get(1)?,
        vector: serde_json::from_str(&vec_json).unwrap_or_default(),
        content_hash: row.get(3)?,
      })
    })
    .map_err(|e| e.to_string())?;
  rows
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

/// Insert-or-replace one record (embeddings track content — the caller always supplies the hash).
#[tauri::command]
pub fn vector_upsert(
  app: tauri::AppHandle,
  workspace: String,
  note_id: String,
  title: String,
  vector: Vec<f64>,
  content_hash: String,
) -> Result<(), String> {
  let conn = open_index(&app, &workspace)?;
  let vec_json = serde_json::to_string(&vector).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT OR REPLACE INTO vectors(note_id, title, vec, content_hash) VALUES (?, ?, ?, ?)",
      duckdb::params![note_id, title, vec_json, content_hash],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn vector_remove(
  app: tauri::AppHandle,
  workspace: String,
  note_id: String,
) -> Result<(), String> {
  let conn = open_index(&app, &workspace)?;
  conn
    .execute("DELETE FROM vectors WHERE note_id = ?", duckdb::params![note_id])
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn vector_clear(app: tauri::AppHandle, workspace: String) -> Result<(), String> {
  let conn = open_index(&app, &workspace)?;
  conn.execute("DELETE FROM vectors", []).map_err(|e| e.to_string())?;
  Ok(())
}
