import type { NoteId, NoteMeta } from "@spherewiki/shared"
import { type ReactNode, useState } from "react"

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
  onMove,
  onCreateInFolder,
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
  /** Rename a note to `title` (repoints its backlinks). Omitted/disabled when the user can't write. */
  onRename?: (id: NoteId, title: string) => void
  /** Move a note into `folder` (`""` = root). Omitted when the vault has no folder concept (web). */
  onMove?: (id: NoteId, folder: string) => void
  /** Create a note directly inside a folder (its "/"-joined path). Omitted without folder support. */
  onCreateInFolder?: (folder: string) => void
  /** Restore a soft-deleted note. */
  onRestore?: (id: NoteId) => void
  canEdit?: boolean
}) {
  // Inline editor for rename / move. A modal `window.prompt` is NOT usable — Tauri's WKWebView has no
  // prompt panel (it silently returns null), so an in-app text input is the only portable affordance
  // (it also works in the browser build). `kind` picks whether Enter commits a title or a folder.
  const [editing, setEditing] = useState<{
    id: NoteId
    kind: "rename" | "move"
    value: string
  } | null>(null)

  const commitEdit = (): void => {
    if (editing === null) return
    const value = editing.value.trim()
    if (editing.kind === "rename") {
      if (value !== "") onRename?.(editing.id, value) // a blank title is a no-op (keep the current one)
    } else {
      onMove?.(editing.id, value) // a blank folder means the vault root
    }
    setEditing(null)
  }

  const renderNote = (m: NoteMeta): ReactNode => {
    if (editing?.id === m.id) {
      const isRename = editing.kind === "rename"
      return (
        <li key={m.id}>
          <input
            // biome-ignore lint/a11y/noAutofocus: an inline editor opened by an explicit click (never on page load) should take focus so the user can type at once.
            autoFocus
            aria-label={`${isRename ? "Rename" : "Move"} ${m.title}`}
            placeholder={isRename ? "New title" : "Folder (blank = root)"}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit()
              else if (e.key === "Escape") setEditing(null)
            }}
            onBlur={() => setEditing(null)} // click away = cancel (Enter commits)
          />
        </li>
      )
    }
    return (
      <li key={m.id}>
        <button type="button" aria-current={m.id === activeId} onClick={() => onSelect(m.id)}>
          {m.title}
        </button>
        {onRename && (
          <button
            type="button"
            aria-label={`Rename ${m.title}`}
            disabled={!canEdit}
            onClick={() => setEditing({ id: m.id, kind: "rename", value: m.title })}
          >
            ✎
          </button>
        )}
        {onMove && (
          <button
            type="button"
            aria-label={`Move ${m.title}`}
            disabled={!canEdit}
            onClick={() => setEditing({ id: m.id, kind: "move", value: m.path ?? "" })}
          >
            🗀
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
  }

  // Render a folder node: its own notes first, then its subfolders (alphabetical) as collapsible
  // groups below them. Notes-first keeps the level's plain notes at the top and groups folders under
  // them (display-only — a note's real location is its `path`, never its position here). Native
  // <details> is keyboard-accessible and needs no React state. `folderPath` is the node's "/"-joined
  // path ("" at the root), used for the key and create-in-folder.
  const renderNode = (node: FolderNode, folderPath: string): ReactNode => (
    <>
      {node.notes.length > 0 && <ul>{node.notes.map(renderNote)}</ul>}
      {[...node.folders.entries()]
        .sort(([a], [b]) => (a.normalize("NFC") < b.normalize("NFC") ? -1 : 1))
        .map(([name, child]) => {
          const childPath = folderPath === "" ? name : `${folderPath}/${name}`
          return (
            <details key={childPath} open className="folder">
              <summary aria-label={`Folder ${name}`}>
                {name}
                {onCreateInFolder && (
                  <button
                    type="button"
                    aria-label={`New note in ${name}`}
                    disabled={!canCreate}
                    // preventDefault so clicking + doesn't also toggle the <details> open/closed.
                    onClick={(e) => {
                      e.preventDefault()
                      onCreateInFolder(childPath)
                    }}
                  >
                    ＋
                  </button>
                )}
              </summary>
              {renderNode(child, childPath)}
            </details>
          )
        })}
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
