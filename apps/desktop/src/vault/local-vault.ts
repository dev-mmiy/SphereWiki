import { asNoteId, type NoteId, type NoteMeta, type Vault } from "@spherewiki/shared"

interface StoredVault {
  notes: Array<{ id: string; title: string; body: string }>
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

export interface LocalStorageVaultOptions {
  /** Storage key; scope per workspace so vaults never co-mingle. */
  readonly key: string
  /** Storage backend; defaults to a working window.localStorage (injectable for tests). */
  readonly storage?: StorageLike
  /** Note-id generator; defaults to a collision-resistant UUID (injectable for deterministic tests). */
  readonly newId?: () => string
}

/** Legacy per-client counter ids (n1, n2, …) — migrated to UUIDs so peers can't collide. */
const LEGACY_ID = /^n\d+$/

/**
 * A collision-resistant note id. UUIDs are globally unique, so two peers can never mint
 * the same id — the registry map key and the body sync room `${workspace}/${id}` are
 * therefore collision-free across peers (a prerequisite for syncing the note list).
 */
function defaultNewId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (webCrypto?.randomUUID !== undefined) return webCrypto.randomUUID()
  // Fallback for an exotic runtime without Web Crypto; tests always inject a deterministic id.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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
 * truth. New notes get globally-unique ids (so the eventual synced note registry and
 * body rooms can't collide across peers); any legacy `n*` ids from older local data are
 * migrated to UUIDs on load, before any sync room is joined. A file-backed Tauri vault
 * implements this same `Vault` seam on the desktop later.
 */
export function createLocalStorageVault(
  seed: ReadonlyArray<{ title: string; body: string }> = [],
  options: LocalStorageVaultOptions,
): Vault {
  const storage = resolveStorage(options.storage)
  const { key } = options
  const newId = options.newId ?? defaultNewId
  const notes = new Map<NoteId, { meta: NoteMeta; body: string }>()

  const persist = (): void => {
    const data: StoredVault = {
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
      for (const n of data.notes) {
        const id = asNoteId(n.id)
        notes.set(id, { meta: { id, title: n.title }, body: n.body })
      }
      return true
    } catch {
      return false
    }
  }

  /** Re-key any legacy per-client `n*` ids to fresh UUIDs, preserving order, title, and body. */
  const migrateLegacyIds = (): boolean => {
    let changed = false
    const rebuilt = new Map<NoteId, { meta: NoteMeta; body: string }>()
    for (const [id, entry] of notes) {
      if (LEGACY_ID.test(id)) {
        const fresh = asNoteId(newId())
        rebuilt.set(fresh, { meta: { id: fresh, title: entry.meta.title }, body: entry.body })
        changed = true
      } else {
        rebuilt.set(id, entry)
      }
    }
    if (changed) {
      notes.clear()
      for (const [id, entry] of rebuilt) notes.set(id, entry)
    }
    return changed
  }

  const create = (title: string, body = ""): NoteMeta => {
    const meta: NoteMeta = { id: asNoteId(newId()), title }
    notes.set(meta.id, { meta, body })
    persist()
    return meta
  }

  const ensure = (id: NoteId, title: string, body = ""): NoteMeta => {
    const existing = notes.get(id)
    if (existing !== undefined) return existing.meta // insert-if-absent: never overwrite a body
    const meta: NoteMeta = { id, title }
    notes.set(id, { meta, body })
    persist()
    return meta
  }

  if (load()) {
    if (migrateLegacyIds()) persist()
  } else {
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
    rename: (id, title) => {
      const note = notes.get(id)
      if (note === undefined) return // no-op on unknown id: a rename targets an existing note
      notes.set(id, { meta: { id, title }, body: note.body }) // title only; body untouched
      persist()
    },
    ensure,
  }
}
