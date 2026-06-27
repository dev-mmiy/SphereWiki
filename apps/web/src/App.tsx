import { CollapsiblePanel, ThemeToggle } from "@spherewiki/ui"

/**
 * The web client shell. Today it is intentionally a *shell*: the web client has no local
 * filesystem and reaches a workspace through the sync super-peer (WebRTC where possible, relay
 * fallback) — that data plane isn't wired here yet. Its purpose is to validate the reuse seam: a
 * second app rendering entirely from `@spherewiki/ui` (tokens + base CSS via the entry, the shared
 * theme module, and the `ThemeToggle` / `CollapsiblePanel` primitives), so the look and behavior
 * cannot drift from desktop. It deliberately exposes *no* ambient note access — there is no
 * connected workspace, honoring project isolation (no "all notes" surface to leak across).
 */
export function WebApp() {
  return (
    <div className="web-app">
      <header className="web-topbar">
        <h1 className="web-brand">SphereWiki</h1>
        <div className="web-topbar-meta">
          <span className="web-tag">Web</span>
          <ThemeToggle />
        </div>
      </header>

      <div className="web-panes">
        <aside className="web-sidebar" aria-label="Navigation">
          <CollapsiblePanel title="Workspaces">
            <p className="web-muted">No workspace connected.</p>
          </CollapsiblePanel>
        </aside>

        <main className="web-main">
          <section className="web-empty" aria-label="Not connected">
            <h2>Connect to a workspace</h2>
            <p>
              The web client reaches a workspace through the sync super-peer (WebRTC where possible,
              with a relay fallback). Sign-in and live sync aren't wired up yet — this is the
              shared-UI shell, rendering entirely from <code>@spherewiki/ui</code>: the same design
              tokens, theme, and primitives as the desktop app.
            </p>
          </section>
        </main>

        <aside className="web-rail" aria-label="Details">
          <CollapsiblePanel title="About">
            <p className="web-muted">
              One design system, two clients: this page uses the same tokens and theme as desktop,
              so they can never drift.
            </p>
          </CollapsiblePanel>
        </aside>
      </div>
    </div>
  )
}
