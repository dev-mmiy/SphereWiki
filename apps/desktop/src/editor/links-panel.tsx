import type { NoteMeta } from "@spherewiki/shared"
import type { OutgoingLink } from "./use-vault-workspace"

/**
 * Outgoing links and backlinks for the active note. A resolved outgoing link navigates to its
 * note; a *dangling* one (a `[[red link]]` with no note yet) offers to create that note — the
 * classic wiki "write the link first, fill it in later" flow — which also resolves the link
 * (wikilinks bind by title, so the new note's title makes `[[title]]` point at it).
 */
export function LinksPanel({
  outgoing,
  backlinks,
  canCreate,
  onNavigate,
  onCreate,
}: {
  outgoing: readonly OutgoingLink[]
  backlinks: readonly NoteMeta[]
  canCreate: boolean
  onNavigate: (title: string) => void
  onCreate: (title: string) => void
}) {
  return (
    <aside>
      <section>
        <h3>Links</h3>
        <ul>
          {outgoing.map((link) =>
            link.exists ? (
              <li key={link.title}>
                <button type="button" onClick={() => onNavigate(link.title)}>
                  {link.title}
                </button>
              </li>
            ) : (
              <li key={link.title}>
                <button
                  type="button"
                  className="dangling"
                  aria-label={`Create note: ${link.title}`}
                  disabled={!canCreate}
                  onClick={() => onCreate(link.title)}
                >
                  {link.title} <span className="dangling-hint">+ create</span>
                </button>
              </li>
            ),
          )}
        </ul>
      </section>
      <section>
        <h3>Backlinks</h3>
        <ul>
          {backlinks.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onNavigate(m.title)}>
                {m.title}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
