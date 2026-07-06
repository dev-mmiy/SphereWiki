import {
  Document,
  isMap,
  parseDocument,
  parse as parseYaml,
  stringify as stringifyYaml,
} from "yaml"
import type { Frontmatter, ParsedNote } from "./types"

const DELIMITER = "---"

/**
 * Split a Markdown document into YAML frontmatter and body.
 *
 * Frontmatter is recognized only when the very first line is exactly `---` and a
 * later line is exactly `---`. A `---` divider inside the body is preserved.
 * Splitting/joining on `\n` is an exact inverse, so the body is byte-preserved.
 */
export function parseNote(source: string): ParsedNote {
  const lines = source.split("\n")
  if (lines[0] !== DELIMITER) {
    return { frontmatter: {}, body: source }
  }

  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === DELIMITER) {
      close = i
      break
    }
  }
  if (close === -1) {
    // Unterminated block — not valid frontmatter; treat the whole input as body.
    return { frontmatter: {}, body: source }
  }

  const yamlText = lines.slice(1, close).join("\n")
  const body = lines.slice(close + 1).join("\n")
  const parsed = yamlText.trim() === "" ? null : (parseYaml(yamlText) as unknown)
  const frontmatter: Frontmatter =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Frontmatter)
      : {}
  return { frontmatter, body }
}

/**
 * Serialize frontmatter + body back to a Markdown document. With no frontmatter
 * keys, the body is returned verbatim. `parseNote(stringifyNote(x))` round-trips.
 */
export function stringifyNote(note: ParsedNote): string {
  if (Object.keys(note.frontmatter).length === 0) {
    return note.body
  }
  const yamlText = stringifyYaml(note.frontmatter) // includes a trailing newline
  return `${DELIMITER}\n${yamlText}${DELIMITER}\n${note.body}`
}

/**
 * Split a note into its raw frontmatter YAML *text* and body, mirroring `parseNote`'s recognition
 * (first line exactly `---`, a later line exactly `---`). Returns `yaml: null` when there is no
 * frontmatter. Unlike `parseNote` this keeps the YAML as text, so an edit can preserve every byte
 * it doesn't touch — sibling keys, their scalar token forms, and comments — rather than
 * re-serializing the whole block.
 */
export function splitFrontmatter(source: string): { yaml: string | null; body: string } {
  const lines = source.split("\n")
  if (lines[0] !== DELIMITER) return { yaml: null, body: source }
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === DELIMITER) {
      close = i
      break
    }
  }
  if (close === -1) return { yaml: null, body: source } // unterminated — not frontmatter
  return { yaml: lines.slice(1, close).join("\n"), body: lines.slice(close + 1).join("\n") }
}

/**
 * Edit only a note's body, preserving its frontmatter **text byte-for-byte** (the inverse hazard
 * of `stringifyNote`, which re-serializes frontmatter and would canonicalize scalars / drop
 * comments). Returns the input verbatim when `transform` leaves the body unchanged.
 */
export function withNoteBody(source: string, transform: (body: string) => string): string {
  const { yaml, body } = splitFrontmatter(source)
  const next = transform(body)
  if (next === body) return source
  return yaml === null ? next : `${DELIMITER}\n${yaml}\n${DELIMITER}\n${next}`
}

/**
 * Set (insert-or-update) string frontmatter keys, preserving everything else. The edit is
 * *surgical* like `addNoteTag` — the frontmatter YAML is parsed as a Document and only the given
 * keys are set, so sibling keys, their scalar token forms, comments, and the **body bytes** are
 * preserved; a note with no frontmatter gains a minimal block. Used to place note identity
 * (`id:`, `title:`) into the Markdown so a file-backed vault is rebuildable from `.md` alone
 * (D2), without the whole-frontmatter re-canonicalization `stringifyNote` would impose. Malformed
 * existing YAML is left untouched (returns the source verbatim) rather than risking corruption.
 */
export function upsertFrontmatter(source: string, entries: Record<string, string>): string {
  const keys = Object.keys(entries)
  if (keys.length === 0) return source

  const prepend = (onto: string): string => {
    const doc = new Document(undefined)
    for (const key of keys) doc.set(key, entries[key])
    return `${DELIMITER}\n${doc.toString()}${DELIMITER}\n${onto}`
  }

  const { yaml, body } = splitFrontmatter(source)
  if (yaml === null) return prepend(body) // no frontmatter → add a minimal block above the body

  const doc = parseDocument(yaml)
  // A leading `---…---` region that isn't a YAML *mapping* (a `---` rule, a scalar, or a list) is
  // not real frontmatter and `doc.set` would throw on it — treat the whole source as body and
  // prepend a fresh block, so a note that opens with `---` is never corrupted or dropped.
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents)))
    return prepend(source)
  for (const key of keys) doc.set(key, entries[key])
  return `${DELIMITER}\n${doc.toString()}${DELIMITER}\n${body}`
}
