import { Server } from "@hocuspocus/server"
import {
  createMemoryPersistence,
  type SyncPersistence,
  verifyWorkspaceToken,
} from "@spherewiki/shared"
import * as Y from "yjs"

/**
 * Gates a client's join of a room. Returns true to admit, false to reject. The real impl
 * verifies a WorkOS-issued, workspace-scoped token against the room; a fake drives tests.
 * `token` is null when the client sent none. Enforcing this at the transport makes project
 * isolation / permissions defense-in-depth — a peer can't reach a workspace's room by merely
 * guessing its name (control plane stays server-authoritative).
 */
export type RoomAuthorizer = (ctx: {
  token: string | null
  room: string
}) => boolean | Promise<boolean>

/**
 * A `RoomAuthorizer` that admits a join only if the client presents a valid workspace-scoped token
 * (see `issueWorkspaceToken`) whose workspace matches the room being joined. Rooms are named
 * `<workspaceId>/<note-or-registry>`, so a token minted for workspace A can never join workspace B's
 * rooms — transport-level project isolation. Minting requires the `secret`, so clients can't forge a
 * token; who receives one (per authenticated membership) is decided upstream at issuance (P3b/WorkOS).
 */
export function createWorkspaceTokenAuthorizer(secret: string): RoomAuthorizer {
  return async ({ token, room }) => {
    const claims = await verifyWorkspaceToken(token, secret)
    if (claims === null || claims.workspaceId === "") return false
    // The room must be EXACTLY `<workspaceId>/<single segment>` — a note id or `__registry__`, never
    // a deeper path. Real rooms always have that shape, and requiring it means a token for `team`
    // can't reach `team/secret/note` (which would belong to a *different* workspace whose id begins
    // with `team/`), so scoping never rests on the assumption that workspace ids are slash-free.
    const prefix = `${claims.workspaceId}/`
    if (!room.startsWith(prefix)) return false
    const rest = room.slice(prefix.length)
    return rest.length > 0 && !rest.includes("/")
  }
}

export interface SyncServerOptions {
  port?: number
  /** Durable backing store for room state; defaults to in-memory. */
  persistence?: SyncPersistence
  /** Debounce (ms) before onStoreDocument persists; lower it in tests for prompt saves. */
  debounce?: number
  /**
   * Gate room joins. When set, every client must present a token this authorizer accepts for
   * the room it is joining, or the connection is rejected. When omitted, rooms are open (the
   * current dev/local default); the WorkOS-backed authorizer wires in at M3b.
   */
  authorize?: RoomAuthorizer
}

/**
 * The super-peer: a Hocuspocus WebSocket server holding an authoritative,
 * server-readable Yjs replica per room (AD-1), with durability wired through the
 * shared persistence seam — loaded when a room first opens, saved on change
 * (debounced by Hocuspocus). The real implementation of the M3 sync transport.
 */
export function createSyncServer(options: SyncServerOptions = {}): Server {
  const persistence = options.persistence ?? createMemoryPersistence()
  const authorize = options.authorize
  return new Server({
    port: options.port ?? 1234,
    quiet: true,
    ...(options.debounce !== undefined ? { debounce: options.debounce } : {}),
    // Only gate joins when an authorizer is configured — leaving rooms open by default keeps
    // local/dev sync zero-config. A thrown error here rejects the connection (Hocuspocus
    // surfaces it to the client as authenticationFailed); the room is never joined.
    ...(authorize !== undefined
      ? {
          onAuthenticate: async ({
            token,
            documentName,
          }: {
            token: string
            documentName: string
          }) => {
            const ok = await authorize({ token: token === "" ? null : token, room: documentName })
            if (!ok) throw new Error("unauthorized")
          },
        }
      : {}),
    onLoadDocument: async ({ documentName, document }) => {
      const saved = persistence.load(documentName)
      if (saved) {
        try {
          Y.applyUpdate(document, saved)
        } catch {
          // Corrupt/foreign persisted state — start the room fresh rather than crash.
        }
      }
      return document
    },
    onStoreDocument: async ({ documentName, document }) => {
      persistence.save(documentName, Y.encodeStateAsUpdate(document))
    },
  })
}
