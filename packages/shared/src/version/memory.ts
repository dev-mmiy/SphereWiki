import type { CrdtEngine, CrdtNote } from "../crdt/types"
import { textDiff } from "./diff"
import type { Version, VersionStore } from "./types"

export interface MemoryVersionStoreOptions {
  /** Clock for `createdAt` — inject for deterministic tests. */
  now?: () => number
  /** Id generator — inject for deterministic tests. */
  newId?: () => string
}

/** In-memory VersionStore for M1; persistence (DB/GCS) is wired in M3. */
export function createMemoryVersionStore(
  engine: CrdtEngine,
  options: MemoryVersionStoreOptions = {},
): VersionStore {
  const now = options.now ?? (() => Date.now())
  let counter = 0
  const newId = options.newId ?? (() => `v${(++counter).toString()}`)
  const versions: Version[] = []

  const get = (id: string): Version | undefined => versions.find((v) => v.id === id)

  const open = (id: string): CrdtNote => {
    const version = get(id)
    if (version === undefined) throw new Error(`unknown version: ${id}`)
    return engine.fromSnapshot(version.snapshot)
  }

  return {
    commit(note, meta) {
      const previous = versions.at(-1)
      const version: Version = {
        id: newId(),
        snapshot: note.snapshot(),
        createdAt: now(),
        origin: meta.origin,
        ...(meta.label !== undefined ? { label: meta.label } : {}),
        ...(previous !== undefined ? { parentId: previous.id } : {}),
      }
      versions.push(version)
      return version
    },
    list: () => versions.slice(),
    get,
    open,
    diff(fromId, toId) {
      const before = open(fromId)
      const after = open(toId)
      try {
        return textDiff(before.getText(), after.getText())
      } finally {
        before.destroy()
        after.destroy()
      }
    },
  }
}
