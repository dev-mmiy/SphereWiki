import type { CrdtNote, CrdtSnapshot, EditOrigin } from "../crdt/types"

/** A committed point in a note's history (AD-5). */
export interface Version {
  readonly id: string
  readonly snapshot: CrdtSnapshot
  readonly createdAt: number
  readonly origin: EditOrigin
  readonly label?: string
  readonly parentId?: string
}

export type DiffOp = "eq" | "ins" | "del"
export interface DiffChunk {
  readonly op: DiffOp
  readonly text: string
}

/**
 * Git-like history on top of the CRDT adapter — engine-agnostic. The in-memory
 * implementation backs M1; DB/GCS-backed stores land in M3 behind this contract.
 */
export interface VersionStore {
  /** Capture the note's current state as a new version. */
  commit(note: CrdtNote, meta: { origin: EditOrigin; label?: string }): Version
  /** Versions in commit order. */
  list(): readonly Version[]
  get(id: string): Version | undefined
  /** Materialize a note at a past version (preview / revert source). */
  open(id: string): CrdtNote
  /** Textual diff between two versions. */
  diff(fromId: string, toId: string): readonly DiffChunk[]
}
