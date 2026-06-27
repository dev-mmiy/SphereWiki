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
  const dialogRef = useRef<HTMLDivElement>(null)

  // On open: reset the query + selection and move focus into the dialog; on close: restore focus
  // to whatever was focused before (standard modal a11y, so keyboard users aren't dumped at the top).
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    setQuery("")
    setActive(0)
    inputRef.current?.focus()
    return () => previouslyFocused?.focus?.()
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

  // Trap Tab within the dialog so keyboard focus can't wander to the page behind the modal. Only
  // the boundaries wrap (Shift+Tab at the first → last, Tab at the last → first); arrow/Enter/Esc
  // stay on the input handler. Lives at the dialog level so it fires whichever child holds focus.
  const onTabTrap = (e: React.KeyboardEvent): void => {
    if (e.key !== "Tab") return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("input, button")).filter(
      (el) => !el.hasAttribute("disabled"),
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) return
    const activeEl = document.activeElement
    if (e.shiftKey && activeEl === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault()
      first.focus()
    }
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
      <div
        ref={dialogRef}
        className="qs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        onKeyDown={onTabTrap}
      >
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
