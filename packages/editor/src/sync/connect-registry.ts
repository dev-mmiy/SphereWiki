import { HocuspocusProvider } from "@hocuspocus/provider"
import type { YjsBackedRegistry } from "@spherewiki/shared"
import type { ServerSyncOptions } from "./connect-server"

/** The registry connect seam — swappable for a fake in tests, mirroring ConnectNote. */
export type ConnectRegistry = (
  registry: YjsBackedRegistry,
  options: ServerSyncOptions,
) => () => void

/**
 * Connect the workspace note-registry CRDT to the super-peer for live sync, so the note
 * LIST converges across peers (a note created on one peer appears on the others). Mirrors
 * connectNoteToServer but for the registry doc; Yjs only appears at this desktop transport
 * boundary. Returns a disconnect function.
 */
export const connectRegistryToServer: ConnectRegistry = (registry, options) => {
  const provider = new HocuspocusProvider({
    url: options.url,
    name: options.room,
    document: registry.ydoc,
    ...(options.token !== undefined ? { token: options.token } : {}),
  })
  provider.on("synced", options.onHydrated)
  return () => provider.destroy()
}
