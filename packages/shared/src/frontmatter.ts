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
