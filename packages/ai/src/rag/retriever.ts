import { contentHash } from "../embedding/hash"
import type { CitedChunk, RagRetriever, RagRetrieverDeps } from "./types"

/**
 * Scoped RAG retriever. Embeds the query once, searches the project index plus any
 * read-only shared indexes, then for each hit:
 *  - reads the citation text via `readBody` (Markdown stays the source of truth), and
 *  - drops the hit if the body's content hash no longer matches the embedding's
 *    (`hit.contentHash`) — stale text is never served (invariant 7).
 * Hits are de-duplicated by noteId (highest score wins; the project index is preferred
 * on ties since it is searched first), ranked by score desc (stable noteId tie-break),
 * and the top-k returned. It touches only the indexes handed to it.
 */
export function createRagRetriever(deps: RagRetrieverDeps): RagRetriever {
  return {
    async retrieve(query) {
      const k = query.k ?? 5
      const [queryVector] = await deps.embedder.embed([query.text])
      if (queryVector === undefined) return []

      const indexes = [deps.project, ...(deps.shared ?? [])]
      const best = new Map<string, CitedChunk>()
      for (const index of indexes) {
        for (const hit of index.search(queryVector, k)) {
          const text = deps.readBody(hit.noteId)
          if (contentHash(text) !== hit.contentHash) continue // stale embedding — do not serve
          const existing = best.get(hit.noteId)
          if (existing === undefined || hit.score > existing.score) {
            best.set(hit.noteId, { noteId: hit.noteId, title: hit.title, text, score: hit.score })
          }
        }
      }

      const chunks = [...best.values()]
      chunks.sort(
        (a, b) => b.score - a.score || (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0),
      )
      return chunks.slice(0, Math.max(0, k))
    },
  }
}
