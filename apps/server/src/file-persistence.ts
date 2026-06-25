import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { SyncPersistence } from "@spherewiki/shared"

/**
 * File-backed SyncPersistence for the super-peer: one binary file per room under
 * `dir`, holding the room's encoded CRDT state. Durable across restarts with no
 * external services.
 *
 * The filename is a SHA-256 hash of the room name, which keeps it fixed-length and
 * slash-free regardless of the room: rooms can never co-mingle or escape `dir`
 * (per-room isolation, AD-1/AD-8), and arbitrarily long `workspaceId/noteId` rooms
 * never hit the filesystem name-length limit. Writes are atomic (temp file +
 * rename) so a crash can never leave a truncated file that bricks the room on
 * load. Cloud SQL/GCS implement this same seam later.
 */
export function createFilePersistence(dir: string): SyncPersistence {
  mkdirSync(dir, { recursive: true })
  const fileFor = (room: string): string =>
    join(dir, `${createHash("sha256").update(room).digest("hex")}.bin`)

  return {
    load(room) {
      const file = fileFor(room)
      if (!existsSync(file)) return null
      return new Uint8Array(readFileSync(file))
    },
    save(room, state) {
      const file = fileFor(room)
      const tmp = `${file}.tmp`
      writeFileSync(tmp, state)
      renameSync(tmp, file) // atomic within the directory — no torn writes
    },
  }
}
