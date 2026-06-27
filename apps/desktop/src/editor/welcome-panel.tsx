type Tip = { keys: string; text: string }

// The first things worth knowing — the shortcuts that make the editor feel fast. Kept short so the
// welcome stays a calm onboarding card, not a manual; the full list lives in the `?` help overlay.
const TIPS: readonly Tip[] = [
  { keys: "⌘ / Ctrl-K", text: "jump to any note" },
  { keys: "[[", text: "link to another note as you type" },
  { keys: "?", text: "all keyboard shortcuts" },
]

/**
 * The first-run welcome shown when the workspace has no (live) notes. It introduces what SphereWiki
 * is, surfaces the few shortcuts that make it feel fast, and offers the primary "create" action —
 * plus a pointer back to the Trash when the empty state is the result of deletions rather than a
 * brand-new workspace. Purely presentational; the caller owns create / show-shortcuts / restore.
 */
export function WelcomePanel({
  canCreate,
  onCreate,
  onShowShortcuts,
  deletedCount = 0,
}: {
  canCreate: boolean
  onCreate: () => void
  onShowShortcuts: () => void
  deletedCount?: number
}) {
  return (
    <section className="welcome" aria-label="Welcome to SphereWiki">
      <h2 className="welcome-title">Welcome to SphereWiki</h2>
      <p className="welcome-lead">
        A team knowledge base where people and AI grow the wiki together — local-first, and yours
        offline. Write in Markdown; on save the AI auto-links and auto-tags, and every change —
        human or AI — is versioned and revertible.
      </p>
      <ul className="welcome-tips">
        {TIPS.map((t) => (
          <li key={t.keys}>
            <kbd>{t.keys}</kbd> <span>{t.text}</span>
          </li>
        ))}
      </ul>
      <div className="welcome-actions">
        <button type="button" className="welcome-primary" disabled={!canCreate} onClick={onCreate}>
          Create your first note
        </button>
        <button type="button" className="welcome-secondary" onClick={onShowShortcuts}>
          Keyboard shortcuts
        </button>
      </div>
      {deletedCount > 0 && (
        <p className="welcome-hint">
          …or restore one of {deletedCount} from the Trash in the sidebar.
        </p>
      )}
    </section>
  )
}
