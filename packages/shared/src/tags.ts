import { parseNote } from "./frontmatter"
import type { TagIndex } from "./types"

/**
 * Read a note's tags from its YAML frontmatter `tags:` list — the read boundary for tags, the
 * way `buildLinkGraph` is for wikilinks. Tags are *derived* from the Markdown (the single source
 * of truth), so this never carries its own state. Normalized: each tag is trimmed, empty and
 * non-string entries are dropped, and duplicates are removed while preserving document order.
 */
export function noteTags(source: string): string[] {
  const raw = parseNote(source).frontmatter.tags
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const tag = entry.trim()
    if (tag !== "" && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** Build the tag → notes and note → tags indexes for a set of notes. Rebuildable from Markdown. */
export function buildTagIndex(notes: Iterable<{ id: string; body: string }>): TagIndex {
  const byTag = new Map<string, Set<string>>()
  const byNote = new Map<string, readonly string[]>()

  for (const note of notes) {
    const tags = noteTags(note.body)
    byNote.set(note.id, tags)
    for (const tag of tags) {
      let ids = byTag.get(tag)
      if (ids === undefined) {
        ids = new Set<string>()
        byTag.set(tag, ids)
      }
      ids.add(note.id)
    }
  }

  return { byTag, byNote }
}
