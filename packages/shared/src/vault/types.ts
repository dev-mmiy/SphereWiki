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
}
