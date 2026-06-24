import type { NoteId, WorkspaceId } from "@spherewiki/shared"
import type { ContentHash } from "../embedding/hash"
import type { EmbeddingModelInfo, EmbeddingVector } from "../embedding/types"

/**
 * Per-workspace vector index seam (M4a). Two invariants are enforced *by the type
 * shape*, not by convention:
 *
 *  - Project isolation: an index is sealed to one `workspaceId` at construction and
 *    NO method accepts a workspaceId, so cross-workspace access is unrepresentable.
 *    The only opt-in bridge is passing a shared workspace's `ReadonlyVectorIndex`
 *    to the RAG retriever (read-only by type).
 *  - Embeddings track content: `upsert` accepts only a whole `EmbeddingRecord`, so a
 *    vector can never be stored without the `ContentHash` of its source text. There
 *    is deliberately no `upsert(noteId, vector)` overload.
 *
 * DuckDB (desktop) and Postgres/pgvector (server) implement this same contract at
 * M4b, with row-level workspace_id + RLS beneath the by-construction isolation.
 */
export interface EmbeddingRecord {
  readonly noteId: NoteId
  readonly title: string
  readonly vector: EmbeddingVector
  readonly contentHash: ContentHash
}

export interface VectorHit {
  readonly noteId: NoteId
  readonly title: string
  readonly score: number
  /** Hash of the text this vector was built from; a consumer can detect a stale hit. */
  readonly contentHash: ContentHash
}

/** Read-only view: the shape a shared workspace is exposed as to the RAG retriever. */
export interface ReadonlyVectorIndex {
  readonly workspaceId: WorkspaceId
  readonly model: EmbeddingModelInfo
  /** Top-k records by cosine similarity to `query`, descending (stable noteId tie-break). */
  search(query: EmbeddingVector, k: number): VectorHit[]
  /** Stored content hash for a note, or undefined if it is not indexed. */
  hashOf(noteId: NoteId): ContentHash | undefined
  /** Stable snapshot of every record, sorted by noteId (for idempotency assertions). */
  records(): readonly EmbeddingRecord[]
}

export interface VectorIndex extends ReadonlyVectorIndex {
  upsert(record: EmbeddingRecord): void
  remove(noteId: NoteId): void
  clear(): void
}
