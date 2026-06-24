import type { NoteId, NoteMeta } from "@spherewiki/shared"

export function NoteList({
  notes,
  activeId,
  onSelect,
  onCreate,
  canCreate = true,
}: {
  notes: readonly NoteMeta[]
  activeId: NoteId
  onSelect: (id: NoteId) => void
  onCreate: () => void
  canCreate?: boolean
}) {
  return (
    <nav>
      <button type="button" onClick={onCreate} disabled={!canCreate}>
        New note
      </button>
      <ul>
        {notes.map((m) => (
          <li key={m.id}>
            <button type="button" aria-current={m.id === activeId} onClick={() => onSelect(m.id)}>
              {m.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
