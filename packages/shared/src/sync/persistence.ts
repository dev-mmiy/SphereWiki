import type { CrdtUpdate } from "../crdt/types"

/**
 * Durable store for the super-peer's authoritative per-room state. The in-memory
 * implementation backs tests/dev; GCS/SQL-backed stores implement the same
 * contract later (AD-1/AD-8). State is keyed per room — never co-mingled.
 */
export interface SyncPersistence {
  load(room: string): CrdtUpdate | null
  save(room: string, state: CrdtUpdate): void
}

/** In-memory persistence: survives hub restarts as long as this object is reused. */
export function createMemoryPersistence(): SyncPersistence {
  const store = new Map<string, CrdtUpdate>()
  return {
    load: (room) => store.get(room) ?? null,
    save: (room, state) => {
      store.set(room, state)
    },
  }
}
