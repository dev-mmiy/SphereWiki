import type { NoteId } from "@spherewiki/shared"
import type { EmbeddingProvider } from "../embedding/types"
import type { ReadonlyVectorIndex } from "../index-store/types"

/**
 * RAG seam (M4a). Retrieval is scoped by construction: a retriever sees exactly
 * one project index plus any explicitly-passed SHARED indexes — and shared ones
 * are typed `ReadonlyVectorIndex`, so the type system forbids writing them. There
 * is no "search all workspaces" entrypoint. The Answerer is split out so the
 * deterministic extractive stub and the M4b Claude answerer swap independently.
 */

export interface RetrievalQuery {
  readonly text: string
  /** Max chunks to return (default 5). */
  readonly k?: number
}

export interface CitedChunk {
  readonly noteId: NoteId
  readonly title: string
  /** Note body, read from the in-scope Vault — the index never stores authoritative text. */
  readonly text: string
  readonly score: number
}

export interface RagRetrieverDeps {
  readonly embedder: EmbeddingProvider
  /** The active workspace's index. */
  readonly project: ReadonlyVectorIndex
  /** Opt-in, read-only shared-workspace indexes (the only cross-workspace bridge). */
  readonly shared?: readonly ReadonlyVectorIndex[]
  /** Resolve a note's body for citation text; supplied from the in-scope Vault(s). */
  readonly readBody: (noteId: NoteId) => string
}

export interface RagRetriever {
  retrieve(query: RetrievalQuery): Promise<CitedChunk[]>
}

export interface RagAnswer {
  readonly answer: string
  readonly citations: readonly CitedChunk[]
}

export interface Answerer {
  answer(question: string, context: readonly CitedChunk[]): Promise<RagAnswer>
}
