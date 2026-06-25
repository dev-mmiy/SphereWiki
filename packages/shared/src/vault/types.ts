import type { NoteId } from "../types"

export interface NoteMeta {
  readonly id: NoteId
  readonly title: string
}

/**
 * A collection of Markdown notes. In-memory in M2; a file-backed (Tauri fs)
 * implementation slots in behind this same interface later — the same swappable
 * seam pattern as the CRDT engine (AD-5).
 */
export interface Vault {
  list(): NoteMeta[]
  read(id: NoteId): string
  write(id: NoteId, body: string): void
  create(title: string, body?: string): NoteMeta
  /**
   * Insert a note at an explicit id if absent, else return the existing meta unchanged.
   * Idempotent and non-destructive — it never overwrites an existing note's body. Used to
   * materialize a note the synced registry knows about but this replica hasn't stored yet,
   * so opening it never throws on an unknown id and never clobbers local content.
   */
  ensure(id: NoteId, title: string, body?: string): NoteMeta
}
