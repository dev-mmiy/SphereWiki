import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { SyncPersistence } from "@spherewiki/shared"

/**
 * File-backed SyncPersistence for the super-peer: one binary file per room under
 * `dir`, holding the room's encoded CRDT state. Durable across restarts with no
 * external services. Room names are percent-encoded to a safe, slash-free
 * filename, and each room is its own file, so state is never co-mingled and a
 * room name cannot escape `dir` (per-room isolation, AD-1/AD-8). Cloud SQL/GCS
 * implement this same seam later.
 */
export function createFilePersistence(dir: string): SyncPersistence {
  mkdirSync(dir, { recursive: true })
  const fileFor = (room: string): string => join(dir, `${encodeURIComponent(room)}.bin`)

  return {
    load(room) {
      const file = fileFor(room)
      if (!existsSync(file)) return null
      return new Uint8Array(readFileSync(file))
    },
    save(room, state) {
      writeFileSync(fileFor(room), state)
    },
  }
}
