import { useState } from "react"

type Selection = { links: string[]; tags: string[] }

/**
 * Review-before-apply UI for the AI's `suggest` autonomy mode. The agent proposes links/tags but
 * applies nothing; the human ticks the ones to keep and applies them (through the same attributed,
 * revertible AI write path) or dismisses the lot. This is the visible half of "AI never silently
 * touches human work": in suggest mode nothing lands without an explicit click. Candidates start
 * checked. Presentational — the caller owns the suggestion set and the apply/dismiss handlers.
 */
export function SuggestionsReview({
  suggested,
  busy = false,
  onApply,
  onDismiss,
}: {
  suggested: { links: readonly string[]; tags: readonly string[] }
  busy?: boolean
  onApply: (selection: Selection) => void
  onDismiss: () => void
}) {
  const [links, setLinks] = useState<ReadonlySet<string>>(() => new Set(suggested.links))
  const [tags, setTags] = useState<ReadonlySet<string>>(() => new Set(suggested.tags))

  const toggle =
    (setter: (next: ReadonlySet<string>) => void, current: ReadonlySet<string>) =>
    (value: string): void => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      setter(next)
    }
  const toggleLink = toggle(setLinks, links)
  const toggleTag = toggle(setTags, tags)

  const nothing = suggested.links.length === 0 && suggested.tags.length === 0
  const selectedCount = links.size + tags.size

  return (
    <section className="suggestions" aria-label="AI suggestions">
      <h3>AI suggestions</h3>
      {nothing ? (
        <p className="suggestions-empty">No suggestions for this note.</p>
      ) : (
        <>
          {suggested.links.length > 0 && (
            <fieldset className="suggestion-group">
              <legend>Links</legend>
              <ul>
                {suggested.links.map((title) => (
                  <li key={title}>
                    <label>
                      <input
                        type="checkbox"
                        checked={links.has(title)}
                        onChange={() => toggleLink(title)}
                      />{" "}
                      [[{title}]]
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {suggested.tags.length > 0 && (
            <fieldset className="suggestion-group">
              <legend>Tags</legend>
              <ul>
                {suggested.tags.map((tag) => (
                  <li key={tag}>
                    <label>
                      <input
                        type="checkbox"
                        checked={tags.has(tag)}
                        onChange={() => toggleTag(tag)}
                      />{" "}
                      #{tag}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </>
      )}
      <div className="suggestions-actions">
        <button
          type="button"
          className="suggestions-apply"
          disabled={busy || selectedCount === 0}
          onClick={() => onApply({ links: [...links], tags: [...tags] })}
        >
          Apply {selectedCount}
        </button>
        <button type="button" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  )
}
