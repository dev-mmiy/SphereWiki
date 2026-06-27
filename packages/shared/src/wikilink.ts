import type { LinkGraph, WikiLink } from "./types"

const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g

/** True if the whole token is a single bare wikilink, e.g. `[[Home]]`. */
export function isWikiLink(token: string): boolean {
  return /^\[\[[^[\]]+\]\]$/.test(token)
}

/** Extract every `[[wikilink]]` from a Markdown body, with offsets. */
export function extractWikiLinks(body: string): WikiLink[] {
  const links: WikiLink[] = []
  for (const match of body.matchAll(WIKILINK_RE)) {
    const raw = match[0]
    const inner = match[1]
    if (raw === undefined || inner === undefined) continue
    const start = match.index ?? 0
    links.push({ ...parseInner(inner), raw, start, end: start + raw.length })
  }
  return links
}

function parseInner(inner: string): { target: string; alias?: string; anchor?: string } {
  let rest = inner
  const result: { target: string; alias?: string; anchor?: string } = { target: "" }

  const pipe = rest.indexOf("|")
  if (pipe !== -1) {
    result.alias = rest.slice(pipe + 1).trim()
    rest = rest.slice(0, pipe)
  }
  const hash = rest.indexOf("#")
  if (hash !== -1) {
    result.anchor = rest.slice(hash + 1).trim()
    rest = rest.slice(0, hash)
  }
  result.target = rest.trim()
  return result
}

/**
 * Repoint every `[[from]]` wikilink (including `|alias` and `#anchor` forms) at `to`,
 * preserving the alias and anchor. This is the link-integrity primitive behind note rename:
 * because wikilinks resolve by their target *title*, renaming a note means every reference
 * to the old title must be rewritten atomically so no `[[old]]` is left dangling.
 *
 * Matching is exact and case-sensitive on the trimmed target (the same key `buildLinkGraph`
 * uses), and the title is compared literally — never compiled to a regex — so a title with
 * regex-special characters (`C++ Notes`, `a (b)`) repoints correctly and safely. All other
 * text and non-matching links are untouched. Idempotent: a no-op when `from` is blank, when
 * `from === to`, or when nothing matches.
 */
export function renameWikiLinkTargets(body: string, from: string, to: string): string {
  const fromTarget = from.trim()
  const toTarget = to.trim()
  if (fromTarget === "" || fromTarget === toTarget) return body

  let result = ""
  let last = 0
  let changed = false
  for (const link of extractWikiLinks(body)) {
    if (link.target !== fromTarget) continue
    // Canonical re-emit in the parser's own order: target, then #anchor, then |alias.
    const inner =
      toTarget +
      (link.anchor !== undefined ? `#${link.anchor}` : "") +
      (link.alias !== undefined ? `|${link.alias}` : "")
    result += body.slice(last, link.start) + `[[${inner}]]`
    last = link.end
    changed = true
  }
  return changed ? result + body.slice(last) : body
}

/** Build the outgoing-link and backlink indexes for a set of notes. */
export function buildLinkGraph(notes: Iterable<{ id: string; body: string }>): LinkGraph {
  const outgoing = new Map<string, Set<string>>()
  const backlinks = new Map<string, Set<string>>()

  for (const note of notes) {
    const targets = new Set<string>()
    for (const link of extractWikiLinks(note.body)) {
      targets.add(link.target)
      let back = backlinks.get(link.target)
      if (back === undefined) {
        back = new Set<string>()
        backlinks.set(link.target, back)
      }
      back.add(note.id)
    }
    outgoing.set(note.id, targets)
  }

  return { outgoing, backlinks }
}

/**
 * Rank note titles for `[[wikilink]]` autocomplete given what the user has typed after `[[`.
 * Case-insensitive: prefix matches rank ahead of mid-string matches; within each group the input
 * order is preserved (callers pass titles in their preferred order, e.g. most-recent-first). An
 * empty query returns the leading titles (so `[[` can list everything). Duplicates are dropped and
 * the result is capped at `limit`. Pure and engine-agnostic — the CodeMirror source wraps it.
 */
export function wikilinkSuggestions(titles: readonly string[], typed: string, limit = 8): string[] {
  const q = typed.trim().toLowerCase()
  const seen = new Set<string>()
  const prefix: string[] = []
  const substring: string[] = []
  for (const title of titles) {
    if (title === "" || seen.has(title)) continue
    const lower = title.toLowerCase()
    if (q === "" || lower.startsWith(q)) {
      seen.add(title)
      prefix.push(title)
    } else if (lower.includes(q)) {
      seen.add(title)
      substring.push(title)
    }
  }
  return [...prefix, ...substring].slice(0, Math.max(0, limit))
}
