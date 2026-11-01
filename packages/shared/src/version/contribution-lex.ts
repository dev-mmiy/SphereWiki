import { parseNote } from "../frontmatter.js"
import { extractWikiLinks } from "../wikilink.js"

/**
 * M5 — the AI link/tag *lexicon*, in one place so the contribution ledger and
 * the on-save agent agree exactly on *what a link or tag is*.
 *
 * The AI records "I added link X / tag Y" through `appliedLinks`/`appliedTags` in
 * `on-save.ts`, which are the diff of these two projections between the
 * pre- and post-edit text. For a "kept vs reverted" judgment to be meaningful,
 * an AI-introduced *value* and the note's *current* value must run through the
 * same projection — so this module owns the projection and both sides reuse it.
 */

/** The content-link targets a note currently carries (deduped, sorted). */
export function linksOf(text: string): string[] {
  const out = new Set<string>()
  for (const link of extractWikiLinks(parseNote(text).body)) {
    const target = link.target.trim()
    if (target !== "") out.add(target)
  }
  return [...out].sort()
}

/** The frontmatter `tags:` a note currently carries (deduped, sorted). */
export function tagsOf(text: string): string[] {
  const out = new Set<string>()
  const tags = parseNote(text).frontmatter.tags
  if (Array.isArray(tags)) {
    for (const t of tags) if (typeof t === "string") out.add(t.trim())
  }
  return [...out].sort().filter((t) => t !== "")
}

/** The link/tag additions produced by going from `prev` to `next`. */
export interface LinkTagDelta {
  readonly links: string[]
  readonly tags: string[]
}

export function linkTagDelta(prev: string, next: string): LinkTagDelta {
  const prevLinks = new Set(linksOf(prev))
  const prevTags = new Set(tagsOf(prev))
  return {
    links: linksOf(next).filter((l) => !prevLinks.has(l)),
    tags: tagsOf(next).filter((t) => !prevTags.has(t)),
  }
}
