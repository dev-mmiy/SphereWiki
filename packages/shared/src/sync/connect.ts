import type { CrdtNote } from "../crdt/types"
import type { SyncHub } from "./types"

/**
 * Wire a note to a sync hub: apply remote updates, push local edits. Echo is
 * avoided because applied remote updates are flagged non-local by `onUpdate`.
 * Returns a disconnect function.
 */
export function connectNoteToHub(note: CrdtNote, hub: SyncHub, room: string): () => void {
  const conn = hub.connect(room, (update) => note.applyUpdate(update))
  conn.send(note.encodeState()) // merge our current state into the hub
  const off = note.onUpdate((update, info) => {
    if (info.local) conn.send(update)
  })
  return () => {
    off()
    conn.disconnect()
  }
}
