import type { NoteId, NoteMeta } from "@spherewiki/shared"
import { type FormEvent, useState } from "react"

/**
 * Shows the active note's tags (read from its frontmatter — the AI's auto-tags surface here).
 * Clicking a tag reveals the other notes carrying it, so tags double as navigation, mirroring
 * the backlinks list. With write permission, tags are also human-editable — add one via the
 * form, or remove one with its `×` — so people and AI co-curate the same tags; the edit rides
 * the note's CRDT doc (attributed, revertible). Tag membership is workspace-scoped by
 * construction (it comes from the hook's `notesForTag`, derived from this workspace's notes only).
 */
export function TagsPanel({
  tags,
  activeId,
  canEdit,
  notesForTag,
  onNavigate,
  onAddTag,
  onRemoveTag,
}: {
  tags: readonly string[]
  activeId: NoteId
  canEdit: boolean
  notesForTag: (tag: string) => readonly NoteMeta[]
  onNavigate: (id: NoteId) => void
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
}) {
  const [openTag, setOpenTag] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  // Validate the opened tag against the current tags: if the active note no longer carries it
  // (e.g. the user removed it), treat it as closed rather than showing a stale list.
  const active = openTag !== null && tags.includes(openTag) ? openTag : null
  const shown = active === null ? [] : notesForTag(active)

  const submitAdd = (e: FormEvent): void => {
    e.preventDefault()
    const tag = draft.trim()
    if (tag === "") return
    onAddTag(tag)
    setDraft("")
  }

  return (
    <section aria-label="Tags" className="tags">
      {tags.length === 0 ? (
        <p className="tags-empty">No tags yet — add one below or run "Organize with AI".</p>
      ) : (
        <ul className="tag-chips">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                aria-pressed={active === tag}
                onClick={() => setOpenTag((t) => (t === tag ? null : tag))}
              >
                #{tag}
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="tag-remove"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="tag-add" onSubmit={submitAdd}>
          <input
            type="text"
            aria-label="Add tag"
            placeholder="add tag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
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
