/**
 * The thin CRDT boundary (AD-4 / AD-5). Nothing above this layer may import a
 * concrete engine (Yjs) — product code and the version layer depend only on
 * these interfaces, so the engine can be swapped (Yjs → Loro/Automerge).
 */

/** Opaque binary CRDT update — self-contained full state, used for sync/persistence. */
export type CrdtUpdate = Uint8Array
/** Opaque binary restore point used by the version layer. */
export type CrdtSnapshot = Uint8Array

/** Attribution attached to each edit; surfaced in history. */
export interface EditOrigin {
  /** Actor making the edit: a user id, or the AI agent's id. */
  readonly actor: string
  /** Distinguishes human edits from the on-save AI agent. */
  readonly kind: "human" | "ai"
}

export interface CrdtTextEvent {
  /** Full document text after the change. */
  readonly text: string
  /** Origin of a local edit, when known. */
  readonly origin?: EditOrigin
  /** True when the change arrived via a merged remote update. */
  readonly remote: boolean
}

/** A single note's CRDT document (one Y.Doc per note in the Yjs impl). */
export interface CrdtNote {
  /** Current full Markdown text. */
  getText(): string
  /** Replace the text via a minimal diff applied as CRDT ops, tagged with origin. */
  setText(next: string, origin: EditOrigin): void
  /** Merge a remote/peer update. */
  applyUpdate(update: CrdtUpdate): void
  /** Encode the whole current state (self-contained) for sync/persistence. */
  encodeState(): CrdtUpdate
  /** Encode a restorable snapshot for the version layer. */
  snapshot(): CrdtSnapshot
  /** Observe text changes; returns an unsubscribe function. */
  subscribe(listener: (event: CrdtTextEvent) => void): () => void
  /** Observe raw CRDT updates for sync transports; `local` is false for merged remote updates. */
  onUpdate(listener: (update: CrdtUpdate, info: { local: boolean }) => void): () => void
  /** Release resources. */
  destroy(): void
}

/** Engine factory — the only abstraction that a concrete engine implements. */
export interface CrdtEngine {
  /** Create an empty document, or load one from a prior update. */
  open(init?: CrdtUpdate): CrdtNote
  /** Reconstruct a document from a snapshot (for preview/revert). */
  fromSnapshot(snapshot: CrdtSnapshot): CrdtNote
}
