import { Server } from "@hocuspocus/server"
import { createMemoryPersistence, type SyncPersistence } from "@spherewiki/shared"
import * as Y from "yjs"

export interface SyncServerOptions {
  port?: number
  /** Durable backing store for room state; defaults to in-memory. */
  persistence?: SyncPersistence
}

/**
 * The super-peer: a Hocuspocus WebSocket server holding an authoritative,
 * server-readable Yjs replica per room (AD-1), with durability wired through the
 * shared persistence seam — loaded when a room first opens, saved on change
 * (debounced by Hocuspocus). The real implementation of the M3 sync transport.
 */
export function createSyncServer(options: SyncServerOptions = {}): Server {
  const persistence = options.persistence ?? createMemoryPersistence()
  return new Server({
    port: options.port ?? 1234,
    quiet: true,
    onLoadDocument: async ({ documentName, document }) => {
      const saved = persistence.load(documentName)
      if (saved) Y.applyUpdate(document, saved)
      return document
    },
    onStoreDocument: async ({ documentName, document }) => {
      persistence.save(documentName, Y.encodeStateAsUpdate(document))
    },
  })
}
