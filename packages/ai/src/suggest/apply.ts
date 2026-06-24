import { extractWikiLinks, parseNote, stringifyNote } from "@spherewiki/shared"
import type { LinkSuggestion, TagSuggestion } from "./types"

/**
 * Pure application of inert suggestions to a note's text. This produces the exact
 * `next` string the on-save agent hands to `CrdtNote.setText`, so the resulting
 * CRDT diff stays minimal. Every function here is idempotent: re-applying an
 * already-applied suggestion is a no-op.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Wrap the first whole-word, not-already-linked occurrence of `title` in `[[...]]`. */
function linkFirstUnlinked(body: string, title: string): string {
  const trimmed = title.trim()
  if (trimmed === "") return body
  const existing = extractWikiLinks(body)
  // Idempotent: at most one link per target — if it is already linked anywhere, do nothing.
  if (existing.some((l) => l.target === trimmed)) return body
  const linked = existing.map((l) => ({ start: l.start, end: l.end }))
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`, "giu")
  for (const match of body.matchAll(re)) {
    const start = match.index ?? 0
    const matched = match[0]
    const end = start + matched.length
    const inside = linked.some((span) => start >= span.start && end <= span.end)
    if (inside) continue
    // Always target the canonical title; keep a different-cased mention as the display alias.
    const replacement = matched === trimmed ? `[[${trimmed}]]` : `[[${trimmed}|${matched}]]`
    return body.slice(0, start) + replacement + body.slice(end)
  }
  return body
}

/**
 * Apply each link suggestion to the body, recomputing existing-link spans after
 * every insertion so earlier insertions never corrupt later offsets.
 */
export function applyLinkSuggestions(body: string, links: readonly LinkSuggestion[]): string {
  let result = body
  // Longest title first: a more specific link (e.g. "Getting Started Guide") wins, and its
  // shorter substring ("Getting Started") then matches only inside the link span and is skipped.
  const ordered = [...links].sort((a, b) => b.title.length - a.title.length)
  for (const link of ordered) result = linkFirstUnlinked(result, link.title)
  return result
}

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : []
}

/**
 * Merge tag suggestions into frontmatter `tags`, de-duplicating and preserving
 * order. Returns the input verbatim when nothing new is added (byte-preserving).
 */
export function applyTagSuggestions(source: string, tags: readonly TagSuggestion[]): string {
  if (tags.length === 0) return source
  const parsed = parseNote(source)
  const existing = normalizeTags(parsed.frontmatter.tags)
  const merged = [...existing]
  for (const t of tags) if (!merged.includes(t.tag)) merged.push(t.tag)
  if (merged.length === existing.length) return source
  return stringifyNote({ frontmatter: { ...parsed.frontmatter, tags: merged }, body: parsed.body })
}

/** Compose link suggestions (into the body) and tag suggestions (into frontmatter). */
export function buildAgentEdit(
  source: string,
  suggestions: { links: readonly LinkSuggestion[]; tags: readonly TagSuggestion[] },
): string {
  const parsed = parseNote(source)
  const nextBody = applyLinkSuggestions(parsed.body, suggestions.links)
  const withLinks =
    nextBody === parsed.body
      ? source
      : stringifyNote({ frontmatter: parsed.frontmatter, body: nextBody })
  return applyTagSuggestions(withLinks, suggestions.tags)
}
