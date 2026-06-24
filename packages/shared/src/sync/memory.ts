import type { CrdtEngine, CrdtNote, CrdtUpdate } from "../crdt/types"
import type { SyncConnection, SyncHub } from "./types"

interface Room {
  doc: CrdtNote
  conns: Map<number, (update: CrdtUpdate) => void>
}

/**
 * In-memory super-peer for tests/dev: holds one authoritative, server-readable
 * replica per room (AD-1), merges incoming updates, and relays them to peers.
 */
export function createMemorySyncHub(engine: CrdtEngine): SyncHub {
  const rooms = new Map<string, Room>()
  let nextId = 0

  return {
    connect(room, onUpdate): SyncConnection {
      let entry = rooms.get(room)
      if (entry === undefined) {
        entry = { doc: engine.open(), conns: new Map<number, (update: CrdtUpdate) => void>() }
        rooms.set(room, entry)
      }
      const here = entry
      const id = nextId++
      here.conns.set(id, onUpdate)
      onUpdate(here.doc.encodeState()) // deliver current state on join

      return {
        send(update) {
          here.doc.applyUpdate(update)
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
