import type { CrdtEngine, CrdtNote } from "../crdt/types"
import { textDiff } from "./diff"
import type { Version, VersionStore } from "./types"

export interface MemoryVersionStoreOptions {
  /** Clock for `createdAt` — inject for deterministic tests. */
  now?: () => number
  /** Id generator — inject for deterministic tests. */
  newId?: () => string
  /**
   * Pre-load prior versions (e.g. from a persistent store on reload). Copied in, in commit order;
   * the default id counter resumes past them so a new commit can't collide with a loaded `v*` id.
   */
  initial?: readonly Version[]
  /**
   * Called after each commit with the full version list, so a wrapper can persist it. The history
   * logic stays here (engine-agnostic, platform-free); the wrapper supplies the storage.
   */
  onCommit?: (versions: readonly Version[]) => void
}

/**
 * In-memory VersionStore for M1; durable wrappers layer on via `initial` + `onCommit` (the desktop
 * localStorage store), and DB/GCS-backed stores land in M3 behind the same `VersionStore` contract.
 */
export function createMemoryVersionStore(
  engine: CrdtEngine,
  options: MemoryVersionStoreOptions = {},
): VersionStore {
  const now = options.now ?? (() => Date.now())
  // Resume past any pre-loaded versions so the default `v${n}` ids don't collide with loaded ones.
  let counter = options.initial?.length ?? 0
  const newId = options.newId ?? (() => `v${(++counter).toString()}`)
  const versions: Version[] = options.initial !== undefined ? [...options.initial] : []

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
      options.onCommit?.(versions)
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
