import type { YjsBackedRegistry } from "@spherewiki/shared"
import { IndexeddbPersistence } from "y-indexeddb"
import type { LocalDocPersistence } from "./local-persistence"

/** The registry local-persistence seam — swappable for an in-memory fake in tests. */
export type ConnectRegistryPersistence = (
  registry: YjsBackedRegistry,
  room: string,
) => LocalDocPersistence

/**
 * Persist the workspace note-registry CRDT to IndexedDB so the note LIST is readable offline
 * (the last-synced list loads with no server; the super-peer merges live changes on top via
 * Yjs). Mirrors connectLocalPersistence but for the registry doc; Yjs only appears here.
 */
export const connectRegistryPersistence: ConnectRegistryPersistence = (registry, room) => {
  const idb = new IndexeddbPersistence(room, registry.ydoc)
  return {
    whenLoaded: idb.whenSynced.then(() => undefined),
    destroy: () => {
      void idb.destroy()
    },
  }
}
