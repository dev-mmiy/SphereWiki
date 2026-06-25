import { asNoteId, type NoteId, type NoteMeta, type Vault } from "@spherewiki/shared"

interface StoredVault {
  counter: number
  notes: Array<{ id: string; title: string; body: string }>
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

export interface LocalStorageVaultOptions {
  /** Storage key; scope per workspace so vaults never co-mingle. */
  readonly key: string
  /** Storage backend; defaults to a working window.localStorage (injectable for tests). */
  readonly storage?: StorageLike
}

/**
 * Resolve a usable storage: the injected one, else window.localStorage if it is
 * actually functional, else an in-memory fallback. (Some runtimes — e.g. Node's
 * experimental native Web Storage without a file — expose a non-functional
 * localStorage; degrade gracefully instead of throwing.)
 */
function resolveStorage(provided: StorageLike | undefined): StorageLike {
  if (provided !== undefined) return provided
  try {
    const ls = typeof window !== "undefined" ? window.localStorage : undefined
    if (ls) {
      const probe = "__spherewiki_probe__"
      ls.setItem(probe, "ok")
      const ok = ls.getItem(probe) === "ok"
      ls.removeItem(probe)
      if (ok) return ls
    }
  } catch {
    // localStorage missing or non-functional — fall through to the in-memory store.
  }
  const memory = new Map<string, string>()
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => {
      memory.set(k, v)
    },
  }
}

/**
 * A durable, localStorage-backed Vault: the Markdown documents (note list + bodies)
 * survive a reload with zero connectivity — offline-first storage of the source of
 * truth. Same id scheme (`n1`, `n2`, …) as the in-memory vault, so note ids — and
 * thus sync room names — stay stable across reloads. A file-backed Tauri vault
 * implements this same `Vault` seam on the desktop later.
 */
export function createLocalStorageVault(
  seed: ReadonlyArray<{ title: string; body: string }> = [],
  options: LocalStorageVaultOptions,
): Vault {
  const storage = resolveStorage(options.storage)
  const { key } = options
  const notes = new Map<NoteId, { meta: NoteMeta; body: string }>()
  let counter = 0

  const persist = (): void => {
    const data: StoredVault = {
      counter,
      notes: [...notes.values()].map((n) => ({ id: n.meta.id, title: n.meta.title, body: n.body })),
    }
    storage.setItem(key, JSON.stringify(data))
  }

  const load = (): boolean => {
    const raw = storage.getItem(key)
    if (raw === null) return false
    try {
      const data = JSON.parse(raw) as Partial<StoredVault>
      if (!Array.isArray(data.notes)) return false
      counter = typeof data.counter === "number" ? data.counter : 0
      for (const n of data.notes) {
        const id = asNoteId(n.id)
        notes.set(id, { meta: { id, title: n.title }, body: n.body })
      }
      return true
    } catch {
      return false
    }
  }

  const create = (title: string, body = ""): NoteMeta => {
    counter++
    const meta: NoteMeta = { id: asNoteId(`n${counter.toString()}`), title }
    notes.set(meta.id, { meta, body })
    persist()
    return meta
  }

  if (!load()) {
    for (const entry of seed) create(entry.title, entry.body)
  }

  const mustGet = (id: NoteId): { meta: NoteMeta; body: string } => {
    const note = notes.get(id)
    if (note === undefined) throw new Error(`unknown note: ${id}`)
    return note
  }

  return {
    list: () => [...notes.values()].map((n) => n.meta),
    read: (id) => mustGet(id).body,
    write: (id, body) => {
      const note = mustGet(id)
      notes.set(id, { meta: note.meta, body })
      persist()
    },
    create,
  }
}
