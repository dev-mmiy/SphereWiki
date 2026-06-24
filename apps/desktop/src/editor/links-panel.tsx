import type { NoteMeta } from "@spherewiki/shared"

export function LinksPanel({
  outgoing,
  backlinks,
  onNavigate,
}: {
  outgoing: readonly string[]
  backlinks: readonly NoteMeta[]
  onNavigate: (title: string) => void
}) {
  return (
    <aside>
      <section>
        <h3>Links</h3>
        <ul>
          {outgoing.map((title) => (
            <li key={title}>
              <button type="button" onClick={() => onNavigate(title)}>
                {title}
              </button>
            </li>
          ))}
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
