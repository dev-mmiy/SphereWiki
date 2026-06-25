import type { NoteId, NoteMeta } from "@spherewiki/shared"
import { useState } from "react"

/**
 * Shows the active note's tags (read from its frontmatter — the AI's auto-tags surface here).
 * Clicking a tag reveals the other notes carrying it, so tags double as navigation, mirroring
 * the backlinks list. Tag membership is workspace-scoped by construction (it comes from the
 * hook's `notesForTag`, derived from this workspace's notes only).
 */
export function TagsPanel({
  tags,
  activeId,
  notesForTag,
  onNavigate,
}: {
  tags: readonly string[]
  activeId: NoteId
  notesForTag: (tag: string) => readonly NoteMeta[]
  onNavigate: (id: NoteId) => void
}) {
  const [openTag, setOpenTag] = useState<string | null>(null)
  // Validate the opened tag against the current tags: if the active note no longer carries it
  // (e.g. the user edited its frontmatter), treat it as closed rather than showing a stale list.
  const active = openTag !== null && tags.includes(openTag) ? openTag : null
  const shown = active === null ? [] : notesForTag(active)

  return (
    <section aria-label="Tags" className="tags">
      <h3>Tags</h3>
      {tags.length === 0 ? (
        <p className="tags-empty">No tags yet — "Organize with AI" can add some.</p>
      ) : (
        <ul>
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                aria-pressed={active === tag}
                onClick={() => setOpenTag((t) => (t === tag ? null : tag))}
              >
                #{tag}
              </button>
            </li>
          ))}
        </ul>
      )}
      {active !== null && (
        <ul aria-label={`Notes tagged ${active}`}>
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                aria-current={m.id === activeId}
                onClick={() => onNavigate(m.id)}
              >
                {m.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
