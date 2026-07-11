import type { SearchHit } from "@spherewiki/shared"
import { useState } from "react"

/**
 * Full-text search box over the workspace's notes. Typing runs the ranked search (title + body
 * + tags, prefix-matched, workspace-scoped) and lists the hits; clicking one navigates to it.
 * Results are recomputed per keystroke from the current Markdown, so they always reflect the
 * live vault.
 */
export function SearchPanel({
  search,
  onNavigate,
}: {
  search: (query: string) => readonly SearchHit[]
  onNavigate: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<readonly SearchHit[]>([])
  const onChange = (value: string): void => {
    setQuery(value)
    setHits(search(value))
  }

  const searching = query.trim() !== ""
  return (
    <section aria-label="Search" className="search">
      <h3>Search</h3>
      <input
        type="search"
        aria-label="Search notes"
        placeholder="Find notes…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
      {searching &&
        (hits.length === 0 ? (
          <p className="search-empty">No matches</p>
        ) : (
          <ul aria-label="Search results">
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => onNavigate(h.id)}>
                  {h.title}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}
