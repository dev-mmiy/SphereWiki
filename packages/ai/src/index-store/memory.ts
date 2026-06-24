import type { NoteId, WorkspaceId } from "@spherewiki/shared"
import type { EmbeddingModelInfo, EmbeddingVector } from "../embedding/types"
import type { EmbeddingRecord, VectorHit, VectorIndex } from "./types"

/** Dot product == cosine for L2-normalized vectors; defensive under noUncheckedIndexedAccess. */
function dot(a: EmbeddingVector, b: EmbeddingVector): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
  return sum
}

function byNoteId(a: EmbeddingRecord, b: EmbeddingRecord): number {
  return a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0
}

/**
 * In-memory VectorIndex for M4a. Sealed to a single workspace; the real DuckDB /
 * pgvector backends implement the same contract at M4b.
 */
export function createMemoryVectorIndex(
  workspaceId: WorkspaceId,
  model: EmbeddingModelInfo,
): VectorIndex {
  const records = new Map<NoteId, EmbeddingRecord>()

  return {
    workspaceId,
    model,
    upsert(record) {
      if (record.vector.length !== model.dimension) {
        throw new Error(
          `vector dimension ${record.vector.length.toString()} != model dimension ${model.dimension.toString()}`,
        )
      }
      records.set(record.noteId, record)
    },
    remove(noteId) {
      records.delete(noteId)
    },
    clear() {
      records.clear()
    },
    search(query, k) {
      if (query.length !== model.dimension) {
        throw new Error(
          `query dimension ${query.length.toString()} != model dimension ${model.dimension.toString()}`,
        )
      }
      const hits: VectorHit[] = [...records.values()].map((r) => ({
        noteId: r.noteId,
        title: r.title,
        score: dot(query, r.vector),
        contentHash: r.contentHash,
      }))
      hits.sort(
        (a, b) => b.score - a.score || (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0),
      )
      return hits.slice(0, Math.max(0, k))
    },
    hashOf(noteId) {
      return records.get(noteId)?.contentHash
    },
    records() {
      return [...records.values()].sort(byNoteId)
    },
  }
}
