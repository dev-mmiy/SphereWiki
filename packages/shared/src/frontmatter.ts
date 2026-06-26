import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
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
