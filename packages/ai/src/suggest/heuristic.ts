import { extractWikiLinks, parseNote } from "@spherewiki/shared"
import type {
  LinkSuggestion,
  NoteContext,
  NoteSuggestions,
  SuggestionProvider,
  TagSuggestion,
} from "./types"

/**
 * No-LLM suggester for M4a. Auto-link: a sibling note's title mentioned verbatim
 * (whole word) in the body but not already inside a `[[...]]` becomes a link
 * suggestion. Auto-tag: salient body terms (minus stopwords, existing tags, and
 * the note's own title words) ranked by frequency. Output order is deterministic
 * (links by first-occurrence offset, tags by frequency then alphabetically). The
 * richer Claude-backed suggester slots in behind SuggestionProvider at M4b.
 */

const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "your",
  "with",
  "this",
  "that",
  "from",
  "have",
  "has",
  "had",
  "was",
  "were",
  "will",
  "can",
  "all",
  "any",
  "its",
  "into",
  "than",
  "then",
  "them",
  "they",
  "what",
  "when",
  "which",
  "while",
  "who",
  "why",
  "how",
  "see",
  "out",
  "use",
  "via",
  "per",
  "our",
  "their",
  "about",
  "also",
  "more",
  "most",
  "such",
  "some",
  "these",
  "those",
  "here",
  "there",
  "over",
  "only",
])

const MIN_TAG_LEN = 3
const DEFAULT_MAX_TAGS = 3

export interface HeuristicSuggesterOptions {
  readonly maxTags?: number
  readonly stopwords?: ReadonlySet<string>
}

const WORD_RE = /[\p{L}\p{N}]+/gu

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? []
}

/** First offset of `title` as a whole word in `body` that is not inside an existing link, else -1. */
function firstUnlinkedOffset(
  body: string,
  title: string,
  linked: ReadonlyArray<{ start: number; end: number }>,
): number {
  const trimmed = title.trim()
  if (trimmed === "") return -1
  // Unicode-aware word boundaries so "Home" is not matched inside "Homepage".
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_])`, "giu")
  for (const match of body.matchAll(re)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const inside = linked.some((span) => start >= span.start && end <= span.end)
    if (!inside) return start
  }
  return -1
}

function autoLink(
  note: NoteContext,
  body: string,
  siblings: readonly NoteContext[],
): LinkSuggestion[] {
  const existing = extractWikiLinks(body)
  const linked = existing.map((l) => ({ start: l.start, end: l.end }))
  const linkedTargets = new Set(existing.map((l) => l.target))
  const found: Array<{ offset: number; suggestion: LinkSuggestion }> = []
  const seen = new Set<string>()
  for (const sibling of siblings) {
    if (sibling.id === note.id) continue
    if (seen.has(sibling.title)) continue
    if (linkedTargets.has(sibling.title)) continue // already linked once -> don't add another
    const offset = firstUnlinkedOffset(body, sibling.title, linked)
    if (offset < 0) continue
    seen.add(sibling.title)
    found.push({ offset, suggestion: { kind: "link", title: sibling.title, targetId: sibling.id } })
  }
  found.sort((a, b) => a.offset - b.offset || (a.suggestion.title < b.suggestion.title ? -1 : 1))
  return found.map((f) => f.suggestion)
}

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : []
}

function autoTag(
  note: NoteContext,
  body: string,
  existingTags: ReadonlySet<string>,
  stopwords: ReadonlySet<string>,
  maxTags: number,
): TagSuggestion[] {
  const titleWords = new Set(tokenize(note.title))
  const counts = new Map<string, number>()
  for (const token of tokenize(body)) {
    if (token.length < MIN_TAG_LEN) continue
    if (stopwords.has(token)) continue
    if (existingTags.has(token)) continue
    if (titleWords.has(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(0, maxTags))
    .map(([tag]): TagSuggestion => ({ kind: "tag", tag }))
}

export function createHeuristicSuggester(
  options: HeuristicSuggesterOptions = {},
): SuggestionProvider {
  const maxTags = options.maxTags ?? DEFAULT_MAX_TAGS
  const stopwords = options.stopwords ?? DEFAULT_STOPWORDS

  return {
    suggest(request): Promise<NoteSuggestions> {
      const parsed = parseNote(request.note.body)
      const existingTags = new Set(normalizeTags(parsed.frontmatter.tags))
      const links = autoLink(request.note, parsed.body, request.siblings)
      const tags = autoTag(request.note, parsed.body, existingTags, stopwords, maxTags)
      return Promise.resolve({ links, tags })
    },
  }
}
