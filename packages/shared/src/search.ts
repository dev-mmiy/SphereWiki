import { parseNote } from "./frontmatter"
import { noteTags } from "./tags"
import type { SearchHit, SearchIndex, SearchIndexEntry } from "./types"

/** A title match counts for this many body occurrences, so title hits rank first. */
const TITLE_BOOST = 5

/** Lowercase the text and split it into runs of Unicode letters/digits (the search terms). */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Build a derived full-text index over a set of notes. Each note contributes its title, its
 * *parsed* body (frontmatter stripped, so YAML keys like `tags:` are never matched), and its
 * tag values. Pure, deterministic, and workspace-scoped by construction — it only ever indexes
 * the notes handed in, so a search can never reach across workspaces. The in-memory store backs
 * the desktop today; DuckDB FTS implements the same `SearchIndex` shape at M2b.
 */
export function buildSearchIndex(
  notes: Iterable<{ id: string; title: string; body: string }>,
): SearchIndex {
  const byNote = new Map<string, SearchIndexEntry>()
  for (const note of notes) {
    const { body } = parseNote(note.body)
    const tags = noteTags(note.body)
    const terms = new Map<string, number>()
    for (const term of tokenize(`${body} ${tags.join(" ")}`)) {
      terms.set(term, (terms.get(term) ?? 0) + 1)
    }
    byNote.set(note.id, {
      title: note.title,
      terms,
      titleTerms: new Set(tokenize(note.title)),
    })
  }
  return { byNote }
}

/** Sum the occurrences of every indexed term that starts with `prefix`. */
function bodyHits(terms: ReadonlyMap<string, number>, prefix: string): number {
  let n = 0
  for (const [term, count] of terms) if (term.startsWith(prefix)) n += count
  return n
}

/**
 * Rank notes against a query. Tokens match by prefix (so `plan` finds `planning`), every query
 * token must match somewhere (AND), and a title match is boosted so it outranks a body-only hit.
 * Results are sorted by score (desc), then title, then id — fully deterministic. A blank query
 * returns nothing.
 */
export function searchNotes(index: SearchIndex, query: string): SearchHit[] {
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []

  const hits: SearchHit[] = []
  for (const [id, entry] of index.byNote) {
    let total = 0
    let matchedAll = true
    for (const q of queryTerms) {
      const titleHit = [...entry.titleTerms].some((t) => t.startsWith(q)) ? TITLE_BOOST : 0
      const score = bodyHits(entry.terms, q) + titleHit
      if (score === 0) {
        matchedAll = false
        break
      }
      total += score
    }
    if (matchedAll && total > 0) hits.push({ id, title: entry.title, score: total })
  }

  return hits.sort(
    (a, b) =>
      b.score - a.score || (a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : 1),
  )
}
