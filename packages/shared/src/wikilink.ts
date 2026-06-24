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
