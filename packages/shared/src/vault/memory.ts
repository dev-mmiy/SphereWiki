import { asNoteId, type NoteId } from "../types"
import type { NoteMeta, Vault } from "./types"

export interface MemoryVaultOptions {
  /** Id generator — inject for deterministic tests. */
  newId?: () => string
}

/** In-memory Vault for M2; a file-backed Vault (Tauri fs) lands later. */
export function createMemoryVault(
  seed: ReadonlyArray<{ title: string; body: string }> = [],
  options: MemoryVaultOptions = {},
): Vault {
  let counter = 0
  const newId = options.newId ?? (() => `n${(++counter).toString()}`)
  const notes = new Map<NoteId, { meta: NoteMeta; body: string }>()

  const mustGet = (id: NoteId): { meta: NoteMeta; body: string } => {
    const note = notes.get(id)
    if (note === undefined) throw new Error(`unknown note: ${id}`)
    return note
  }

  const create = (title: string, body = ""): NoteMeta => {
    const meta: NoteMeta = { id: asNoteId(newId()), title }
    notes.set(meta.id, { meta, body })
    return meta
  }

  const ensure = (id: NoteId, title: string, body = ""): NoteMeta => {
    const existing = notes.get(id)
    if (existing !== undefined) return existing.meta // insert-if-absent: never overwrite a body
    const meta: NoteMeta = { id, title }
    notes.set(id, { meta, body })
    return meta
  }

  const rename = (id: NoteId, title: string): void => {
    const note = notes.get(id)
    if (note === undefined) return // no-op on unknown id: a rename targets an existing note
    notes.set(id, { meta: { id, title }, body: note.body }) // title only; body untouched
  }

  for (const entry of seed) create(entry.title, entry.body)

  return {
    list: () => [...notes.values()].map((n) => n.meta),
    read: (id) => mustGet(id).body,
    write: (id, body) => {
      const note = mustGet(id)
      notes.set(id, { meta: note.meta, body })
    },
    create,
    rename,
    ensure,
  }
}
