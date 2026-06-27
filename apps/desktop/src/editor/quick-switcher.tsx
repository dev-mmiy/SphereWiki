import type { NoteMeta, SearchHit } from "@spherewiki/shared"
import { useEffect, useRef, useState } from "react"

type Item = { id: string; title: string }

/**
 * A keyboard-first "jump to note" palette (Cmd/Ctrl-K). It reuses the workspace's ranked search
 * (so it's workspace-scoped by construction); an empty query lists all notes. Arrow keys move the
 * selection, Enter opens it, Esc (or a backdrop click) dismisses. `open` is owned by the caller,
 * which also owns the Cmd-K shortcut — this component is presentational and easy to test in
 * isolation. Navigation goes through the same `onNavigate(id)` path as the sidebar.
 */
export function QuickSwitcher({
  open,
  notes,
  search,
  onNavigate,
  onClose,
}: {
  open: boolean
  notes: readonly NoteMeta[]
  search: (query: string) => readonly SearchHit[]
  onNavigate: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset the query + selection each time it opens, and focus the input.
  useEffect(() => {
    if (open) {
      setQuery("")
      setActive(0)
      inputRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  // Empty query → all notes; otherwise the ranked hits. Both already workspace-scoped.
  const items: Item[] =
    query.trim() === ""
      ? notes.map((n) => ({ id: n.id, title: n.title }))
      : search(query).map((h) => ({ id: h.id, title: h.title }))
  // Clamp the selection into range as the result set shrinks while typing.
  const selected = items.length === 0 ? -1 : Math.min(active, items.length - 1)

  const choose = (id: string): void => {
    onNavigate(id)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(items.length === 0 ? 0 : Math.min(selected + 1, items.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(Math.max(selected - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = items[selected]
      if (item) choose(item.id)
    }
  }

  return (
    <div className="qs-overlay">
      {/* The backdrop is a real button (keyboard-dismissable); the dialog is a sibling, so dialog
          clicks never reach it — no stopPropagation / div handlers needed. */}
      <button
        type="button"
        className="qs-backdrop"
        aria-label="Close quick switcher"
        onClick={onClose}
      />
      <div className="qs-dialog" role="dialog" aria-modal="true" aria-label="Quick switcher">
        <input
          ref={inputRef}
          type="text"
          className="qs-input"
          aria-label="Jump to note"
          placeholder="Jump to note…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
        {items.length === 0 ? (
          <p className="qs-empty">No matches</p>
        ) : (
          <ul className="qs-results" aria-label="Quick switcher results">
            {items.map((it, i) => (
              <li key={it.id}>
                <button
                  type="button"
                  aria-current={i === selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it.id)}
                >
                  {it.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
