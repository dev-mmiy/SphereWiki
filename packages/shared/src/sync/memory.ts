import type { CrdtEngine, CrdtNote, CrdtUpdate } from "../crdt/types"
import type { SyncPersistence } from "./persistence"
import type { SyncConnection, SyncHub } from "./types"

interface Room {
  doc: CrdtNote
  conns: Map<number, (update: CrdtUpdate) => void>
}

export interface MemorySyncHubOptions {
  /** Optional durable backing store; without it, state lives only for the hub's lifetime. */
  persistence?: SyncPersistence
}

/**
 * In-memory super-peer for tests/dev: holds one authoritative, server-readable
 * replica per room (AD-1), merges incoming updates, relays them to peers, and
 * (when given a persistence) loads on room creation and saves on every merge.
 */
export function createMemorySyncHub(
  engine: CrdtEngine,
  options: MemorySyncHubOptions = {},
): SyncHub {
  const { persistence } = options
  const rooms = new Map<string, Room>()
  let nextId = 0

  return {
    connect(room, onUpdate): SyncConnection {
      let entry = rooms.get(room)
      if (entry === undefined) {
        const doc = engine.open()
        const persisted = persistence?.load(room)
        if (persisted) doc.applyUpdate(persisted)
        entry = { doc, conns: new Map<number, (update: CrdtUpdate) => void>() }
        rooms.set(room, entry)
      }
      const here = entry
      const id = nextId++
      here.conns.set(id, onUpdate)
      onUpdate(here.doc.encodeState()) // deliver current state on join

      return {
        send(update) {
          here.doc.applyUpdate(update)
          persistence?.save(room, here.doc.encodeState())
          for (const [cid, cb] of here.conns) {
            if (cid !== id) cb(update)
          }
        },
        snapshot: () => here.doc.encodeState(),
        disconnect: () => {
          here.conns.delete(id)
        },
      }
    },
  }
}
