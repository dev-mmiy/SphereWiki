import type { YjsBackedNote } from "@spherewiki/shared"
import { IndexeddbPersistence } from "y-indexeddb"

export interface LocalDocPersistence {
  /** Resolves once any previously persisted state has been loaded into the doc. */
  readonly whenLoaded: Promise<void>
  /** Flush/close and detach from the doc. Safe to call once. */
  destroy: () => void
}

/** The local-persistence seam — swappable for an in-memory fake in tests. */
export type ConnectLocalPersistence = (note: YjsBackedNote, room: string) => LocalDocPersistence

/**
 * Persist a note's CRDT document to the browser's IndexedDB so a *synced* room is
 * readable offline: on open, the last-synced state is loaded from IndexedDB into the
 * doc (no server needed); the super-peer then merges live edits on top via Yjs (both
 * are CRDT updates to the same doc, so they converge). Yjs only appears at this
 * desktop persistence boundary; nothing above the @spherewiki/shared adapter sees it.
 * Returns a handle whose `whenLoaded` resolves after the initial load and whose
 * `destroy` detaches the persistence and closes the database.
 */
export const connectLocalPersistence: ConnectLocalPersistence = (note, room) => {
  const idb = new IndexeddbPersistence(room, note.ydoc)
  return {
    whenLoaded: idb.whenSynced.then(() => undefined),
    destroy: () => {
      void idb.destroy()
    },
  }
}
