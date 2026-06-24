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

  for (const entry of seed) create(entry.title, entry.body)

  return {
    list: () => [...notes.values()].map((n) => n.meta),
    read: (id) => mustGet(id).body,
    write: (id, body) => {
      const note = mustGet(id)
      notes.set(id, { meta: note.meta, body })
    },
    create,
  }
}
