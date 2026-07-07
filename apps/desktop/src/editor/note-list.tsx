import type { NoteId, NoteMeta } from "@spherewiki/shared"
import type { ReactNode } from "react"

/** A folder in the sidebar tree: its own notes plus nested subfolders (keyed by segment name). */
interface FolderNode {
  readonly notes: NoteMeta[]
  readonly folders: Map<string, FolderNode>
}

/** Group a flat note list into a folder tree by each note's `path` (a note with no path is at root).
 * Folders are display-only — a note's identity/links never depend on where it sits (v1b). */
function buildTree(notes: readonly NoteMeta[]): FolderNode {
  const root: FolderNode = { notes: [], folders: new Map() }
  for (const m of notes) {
    const segments = (m.path ?? "").split("/").filter((s) => s !== "")
    let node = root
    for (const segment of segments) {
      let child = node.folders.get(segment)
      if (child === undefined) {
        child = { notes: [], folders: new Map() }
        node.folders.set(segment, child)
      }
      node = child
    }
    node.notes.push(m)
  }
  return root
}

export function NoteList({
  notes,
  activeId,
  onSelect,
  onCreate,
  canCreate = true,
  deleted = [],
  onDelete,
  onRename,
  onRestore,
  canEdit = true,
}: {
  notes: readonly NoteMeta[]
  activeId: NoteId
  onSelect: (id: NoteId) => void
  onCreate: () => void
  canCreate?: boolean
  /** Tombstoned notes still recoverable (the "trash"). */
  deleted?: readonly NoteMeta[]
  /** Soft-delete a note (revertible). Omitted/disabled when the user can't write. */
  onDelete?: (id: NoteId) => void
  /** Rename a note (repoints its backlinks). Omitted/disabled when the user can't write. */
  onRename?: (id: NoteId) => void
  /** Restore a soft-deleted note. */
  onRestore?: (id: NoteId) => void
  canEdit?: boolean
}) {
  const renderNote = (m: NoteMeta): ReactNode => (
    <li key={m.id}>
      <button type="button" aria-current={m.id === activeId} onClick={() => onSelect(m.id)}>
        {m.title}
      </button>
      {onRename && (
        <button
          type="button"
          aria-label={`Rename ${m.title}`}
          disabled={!canEdit}
          onClick={() => onRename(m.id)}
        >
          ✎
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${m.title}`}
          disabled={!canEdit}
          onClick={() => onDelete(m.id)}
        >
          ✕
        </button>
      )}
    </li>
  )

  // Render a folder node: its own notes first, then its subfolders (alphabetical) as collapsible
  // groups — native <details> so it's keyboard-accessible and needs no React state.
  const renderNode = (node: FolderNode, keyPrefix: string): ReactNode => (
    <>
      {node.notes.length > 0 && <ul>{node.notes.map(renderNote)}</ul>}
      {[...node.folders.entries()]
        .sort(([a], [b]) => (a.normalize("NFC") < b.normalize("NFC") ? -1 : 1))
        .map(([name, child]) => (
          <details key={`${keyPrefix}/${name}`} open className="folder">
            <summary aria-label={`Folder ${name}`}>{name}</summary>
            {renderNode(child, `${keyPrefix}/${name}`)}
          </details>
        ))}
    </>
  )

  return (
    <nav>
      <button type="button" onClick={onCreate} disabled={!canCreate}>
        New note
      </button>
      {renderNode(buildTree(notes), "")}
      {deleted.length > 0 && (
        <details className="trash">
          <summary>Trash ({deleted.length})</summary>
          <ul>
            {deleted.map((m) => (
              <li key={m.id}>
                <span>{m.title}</span>
                {onRestore && (
                  <button
                    type="button"
                    aria-label={`Restore ${m.title}`}
                    disabled={!canEdit}
                    onClick={() => onRestore(m.id)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  )
}
