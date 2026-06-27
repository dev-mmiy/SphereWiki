import { useEffect, useRef } from "react"

type Shortcut = { keys: string; label: string }

// The keyboard bindings the shell owns, surfaced for discoverability. Keep this list in sync with
// the global handler in NoteWorkspace and the per-dialog handlers (Esc).
const SHORTCUTS: readonly Shortcut[] = [
  { keys: "⌘ / Ctrl-K", label: "Jump to note" },
  { keys: "⌘ / Ctrl-B", label: "Toggle sidebar" },
  { keys: "?", label: "Show this help" },
  { keys: "Esc", label: "Close dialogs" },
]

/**
 * A small "keyboard shortcuts" modal, opened by `?` (owned by the caller). It reuses the quick
 * switcher's modal frame (`qs-overlay` / `qs-backdrop` / `qs-dialog`) and the same a11y pattern:
 * capture the previously-focused element on open, move focus to the Close button, restore on close.
 * Esc, the Close button, and a backdrop click all dismiss. Purely presentational.
 */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previouslyFocused?.focus?.()
  }, [open])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="qs-overlay">
      <button
        type="button"
        className="qs-backdrop"
        aria-label="Close shortcut help"
        onClick={onClose}
      />
      <div
        className="qs-dialog help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={onKeyDown}
      >
        <h2 className="help-title">Keyboard shortcuts</h2>
        <dl className="help-list">
          {SHORTCUTS.map((s) => (
            <div className="help-row" key={s.keys}>
              <dt>
                <kbd>{s.keys}</kbd>
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="help-close" ref={closeRef} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
