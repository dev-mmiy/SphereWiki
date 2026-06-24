import type { CrdtUpdate } from "../crdt/types"

/** A client's connection to a sync hub room. */
export interface SyncConnection {
  /** Send a local CRDT update to the hub (relayed to peers + merged into the replica). */
  send(update: CrdtUpdate): void
  /** The hub's current authoritative state for the room (server-readable, AD-1). */
  snapshot(): CrdtUpdate
  disconnect(): void
}

/**
 * The super-peer sync seam (AD-1). The in-memory implementation backs tests/dev;
 * a Hocuspocus/WebSocket transport implements the same contract for production.
 */
export interface SyncHub {
  /** Join a room. `onUpdate` receives the current state, then live peer updates. */
  connect(room: string, onUpdate: (update: CrdtUpdate) => void): SyncConnection
}
