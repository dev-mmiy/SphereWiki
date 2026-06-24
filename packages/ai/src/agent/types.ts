import type { CrdtNote, NoteId, Session, VersionStore, WorkspaceId } from "@spherewiki/shared"
import type { EmbeddingProvider } from "../embedding/types"
import type { VectorIndex } from "../index-store/types"
import type { NoteContext, SuggestionProvider } from "../suggest/types"

/** Default identity for the on-save agent's edits; surfaced in version attribution. */
export const AGENT_ACTOR = "ai-agent"

/**
 * Per-workspace AI autonomy (AD-7). M4a implements the off/auto ends; `suggest`
 * (apply nothing, surface candidates for human confirmation) is wired in M4b.
 */
export type Autonomy = "off" | "suggest" | "auto"

export interface OnSaveAcceptPolicy {
  readonly maxLinks?: number
  readonly maxTags?: number
}

/**
 * Everything the agent needs, expressed in the lowest-common-denominator handles
 * the desktop hook and a server CRDT peer both already hold. Note is `CrdtNote`,
 * NOT a Yjs type — no engine type leaks above the @spherewiki/shared adapter.
 */
export interface OnSaveInput {
  readonly session: Session
  readonly workspaceId: WorkspaceId
  readonly noteId: NoteId
  readonly title: string
  readonly note: CrdtNote
  readonly store: VersionStore
  readonly index: VectorIndex
  /** Other notes in this workspace scope (caller-scoped — never cross-project). */
  readonly others: readonly NoteContext[]
  readonly autonomy?: Autonomy
  readonly agentId?: string
  readonly accept?: OnSaveAcceptPolicy
}

export interface OnSaveDeps {
  readonly suggester: SuggestionProvider
  readonly embedder: EmbeddingProvider
}

export type SkipReason = "no-permission" | "autonomy-off" | "autonomy-suggest" | "no-suggestions"

export interface OnSaveResult {
  /** Titles of links the agent ACTUALLY applied (not merely selected). */
  readonly links: readonly string[]
  /** Tags the agent ACTUALLY applied. */
  readonly tags: readonly string[]
  /** The committed AI version id, or null when nothing was applied. */
  readonly versionId: string | null
  readonly applied: boolean
  readonly skippedReason?: SkipReason
  /** In `suggest` mode: candidate links/tags awaiting human confirmation (none applied). */
  readonly suggested?: {
    readonly links: readonly string[]
    readonly tags: readonly string[]
  }
}
