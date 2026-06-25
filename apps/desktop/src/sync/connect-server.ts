import { HocuspocusProvider } from "@hocuspocus/provider"
import type { YjsBackedNote } from "@spherewiki/shared"

export interface ServerSyncOptions {
  /** Super-peer WebSocket URL, e.g. ws://127.0.0.1:8787. */
  readonly url: string
  /** Room name; scope per workspace + note so rooms never co-mingle. */
  readonly room: string
  /** Called once the room has finished its initial sync from the super-peer. */
  readonly onHydrated: () => void
}

/** The connect seam — swappable for a fake in tests so sync logic needs no real socket. */
export type ConnectNote = (note: YjsBackedNote, options: ServerSyncOptions) => () => void

/**
 * Connect a note's CRDT document to the super-peer for live sync. The provider
 * hydrates the doc from the server, relays local edits, and merges peer edits via
 * Yjs; `onHydrated` fires once initial sync completes so the caller knows the doc
 * reflects the server (and not an empty, pre-sync state). Yjs only appears at this
 * desktop transport boundary; nothing above the @spherewiki/shared adapter sees
 * it. Returns a disconnect function.
 */
export const connectNoteToServer: ConnectNote = (note, options) => {
  const provider = new HocuspocusProvider({
    url: options.url,
    name: options.room,
    document: note.ydoc,
  })
  provider.on("synced", options.onHydrated)
  return () => provider.destroy()
}
