import type { NoteId } from "../types"

export interface NoteMeta {
  readonly id: NoteId
  readonly title: string
  /**
   * The note's folder — a "/"-joined, workspace-root-relative directory (e.g. `"work/projects"`),
   * omitted for a top-level note and for vaults with no folder concept (memory/localStorage). Set by
   * the file-backed vault so the UI can render the hierarchy; identity + links never depend on it (a
   * note is addressed by `id`/`title`, so moving folders keeps every `[[wikilink]]` intact).
   */
  readonly path?: string
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
   * Update an existing note's display title in place (its body is untouched); no-op if the id is
   * unknown. The note's `[[wikilink]]` backlinks are repointed by the caller — a rename is more
   * than a metadata change — this only keeps the vault's own title metadata in step with the
   * note's canonical name, so derived views and a future file-backed vault (which renames the
   * underlying `.md`) stay consistent.
   */
  rename(id: NoteId, title: string): void
  /**
   * Insert a note at an explicit id if absent, else return the existing meta unchanged.
   * Idempotent and non-destructive — it never overwrites an existing note's body. Used to
   * materialize a note the synced registry knows about but this replica hasn't stored yet,
   * so opening it never throws on an unknown id and never clobbers local content.
   */
  ensure(id: NoteId, title: string, body?: string): NoteMeta
  /**
   * Optional soft-delete-on-disk hooks (O2). A file-backed vault moves the note's `.md` into a
   * `.trash/` folder (excluded from the Markdown scan / `reindex`, so the derived vector is pruned)
   * and back on restore; the body stays readable + the note stays in `list()` (the caller partitions
   * live vs trash by its own tombstone). The in-memory / localStorage vaults leave these undefined —
   * their soft-delete is the registry tombstone alone, with the body retained in place.
   */
  trash?(id: NoteId): void
  restore?(id: NoteId): void
  /**
   * Optional: move a note into a different folder (`""` = the vault root) — a file-backed vault
   * relocates the `.md`, keeping its `id`, `title`, and body. Folders are display-only, so this is
   * purely organizational: `[[wikilinks]]`, backlinks, and the graph are unaffected (a note is
   * addressed by title/id, never by path). No-op on an unknown/trashed note or if already there. The
   * in-memory / localStorage vaults (no folder concept) leave it undefined.
   */
  move?(id: NoteId, folder: string): void
}
