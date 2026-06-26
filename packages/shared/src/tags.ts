import { Document, isScalar, isSeq, type Node, parseDocument, type YAMLSeq } from "yaml"
import { parseNote, splitFrontmatter } from "./frontmatter"
import type { TagIndex } from "./types"

const DELIMITER = "---"

/** Reassemble a frontmatter Document (already serialized, trailing newline) with the body. */
function joinFrontmatter(yamlText: string, body: string): string {
  return `${DELIMITER}\n${yamlText}${DELIMITER}\n${body}`
}

/** The trimmed string value of a YAML seq item, or undefined for a non-string item. */
function itemTag(node: Node): string | undefined {
  return isScalar(node) && typeof node.value === "string" ? node.value.trim() : undefined
}

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

/**
 * Add a tag to a note's frontmatter `tags:` list (the human counterpart to the AI's auto-tag).
 * Pure and idempotent: the tag is trimmed, a blank or already-present tag is a no-op (returns the
 * input verbatim). The edit is *surgical* — the frontmatter YAML is parsed as a Document and only
 * the `tags` sequence is touched, so sibling keys, their scalar token forms (`version: 1.0` stays
 * `1.0`, not `1`), comments, and the body are preserved. (Residual: the YAML serializer
 * canonicalizes leading-zero / octal integer literals like `007`, which never occur in
 * SphereWiki's own frontmatter — ids are UUIDs, timestamps ISO strings.) A note with no
 * frontmatter gains a `tags` block.
 */
export function addNoteTag(source: string, tag: string): string {
  const clean = tag.trim()
  if (clean === "") return source

  const { yaml, body } = splitFrontmatter(source)
  if (yaml === null) {
    // No frontmatter yet — create a minimal `tags` block (Document handles any needed quoting).
    const doc = new Document(undefined)
    doc.set("tags", [clean])
    return joinFrontmatter(doc.toString(), source)
  }

  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return source // never edit (and risk corrupting) malformed YAML

  const node = doc.get("tags", true) as Node | undefined
  if (isSeq(node)) {
    const seq = node as YAMLSeq
    if (seq.items.some((it) => itemTag(it as Node) === clean)) return source // already present
    seq.add(clean)
  } else if (node === undefined || node === null) {
    doc.set("tags", [clean])
  } else {
    // A non-list `tags:` value (e.g. `tags: notalist`) — keep the original as a tag rather than
    // silently discarding it, then add the new one.
    const existing = itemTag(node)
    doc.set("tags", existing !== undefined && existing !== "" ? [existing, clean] : [clean])
  }
  return joinFrontmatter(doc.toString(), body)
}

/**
 * Remove a tag from a note's frontmatter `tags:` list. Pure and idempotent: removing an absent
 * tag is a no-op. The edit is surgical (only the matching seq item is dropped — other tags,
 * including non-string entries, sibling keys, comments, and the body are preserved). When the
 * last tag goes the `tags` key is dropped (no empty `tags: []`), and if that empties the
 * frontmatter the block is removed entirely.
 */
export function removeNoteTag(source: string, tag: string): string {
  const clean = tag.trim()
  const { yaml, body } = splitFrontmatter(source)
  if (yaml === null) return source

  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return source

  const node = doc.get("tags", true) as Node | undefined
  if (!isSeq(node)) return source
  const seq = node as YAMLSeq
  const index = seq.items.findIndex((it) => itemTag(it as Node) === clean)
  if (index === -1) return source

  seq.items.splice(index, 1)
  if (seq.items.length === 0) doc.delete("tags")

  const rest = doc.toString()
  // An empty Document serializes to "{}\n"/"null\n" — drop the frontmatter block instead.
  if (rest.trim() === "" || rest.trim() === "{}" || rest.trim() === "null") return body
  return joinFrontmatter(rest, body)
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
