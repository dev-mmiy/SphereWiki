/**
 * @spherewiki/shared — platform-free core shared by desktop, server, and tests:
 * Markdown/frontmatter parsing, wikilink/backlink/graph logic, the CRDT adapter,
 * the engine-agnostic versioning layer, and shared types.
 *
 * M0 stub — real modules land in M1 (see docs/ROADMAP.md).
 */

/** Matches a bare wikilink token such as `[[Note Name]]`. */
export function isWikiLink(token: string): boolean {
  return /^\[\[[^[\]]+\]\]$/.test(token)
}
