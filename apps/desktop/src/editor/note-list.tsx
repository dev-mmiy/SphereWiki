import type { NoteId, NoteMeta } from "@spherewiki/shared"
import { type ReactNode, useState } from "react"

/**
 * A node in the outliner tree. Notes nest under notes via the folder-note convention: a note
 * `<path>/<name>.md` holds its children in `<path>/<name>/`, so a child's `path` ends with its
 * parent's `name`. Each node therefore has an OPTIONAL `note` (present when a `.md` sits exactly
 * here) plus `children` (nested nodes). `path` is the node's full "/"-joined path — the folder a new
 * child of this node is created in. A node with children but no `note` is a plain folder container.
 */
interface TreeNode {
  readonly name: string
  readonly path: string
  note?: NoteMeta
  readonly children: Map<string, TreeNode>
}

/** Build the outliner tree: each note attaches to the node at `[...path segments, name]`, so a note
 * and its same-named child folder merge into one expandable node. Segments are NFC-normalized so a
 * child's path segment matches its parent note's stem even across macOS NFD/NFC. */
function buildTree(notes: readonly NoteMeta[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() }
  for (const m of notes) {
    const segments = [...(m.path ?? "").split("/").filter((s) => s !== ""), m.name ?? m.title].map(
      (s) => s.normalize("NFC"),
    )
    let node = root
    let path = ""
    for (const seg of segments) {
      path = path === "" ? seg : `${path}/${seg}`
      let child = node.children.get(seg)
      if (child === undefined) {
        child = { name: seg, path, children: new Map() }
        node.children.set(seg, child)
      }
      node = child
    }
    node.note = m
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
  /** Create a note inside a node's folder (a child of that note / folder). Omitted without folders. */
  onCreateInFolder?: (folder: string) => void
  /** Restore a soft-deleted note. */
  onRestore?: (id: NoteId) => void
  canEdit?: boolean
}) {
  // Inline editor for rename / move — Tauri's WKWebView has no window.prompt (it returns null), so an
  // in-app text input is the only portable affordance (also nicer in the browser build).
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

  // The interactive content of a node's row: the inline editor when this note is being edited, else
  // the note button (or a folder label) plus its actions. `＋` creates a CHILD in this node's folder;
  // preventDefault on every button so clicking one inside a <summary> never toggles the <details>.
  const renderRow = (node: TreeNode): ReactNode => {
    const m = node.note
    if (m !== undefined && editing?.id === m.id) {
      const isRename = editing.kind === "rename"
      return (
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
          onBlur={() => setEditing(null)}
        />
      )
    }
    return (
      <span className="node-row">
        {m !== undefined ? (
          <button
            type="button"
            aria-current={m.id === activeId}
            onClick={(e) => {
              e.preventDefault()
              onSelect(m.id)
            }}
          >
            {m.title}
          </button>
        ) : (
          <span className="folder-label">📁 {node.name}</span>
        )}
        {onCreateInFolder && (
          <button
            type="button"
            aria-label={`New note in ${m?.title ?? node.name}`}
            disabled={!canCreate}
            onClick={(e) => {
              e.preventDefault()
              onCreateInFolder(node.path)
            }}
          >
            ＋
          </button>
        )}
        {m !== undefined && onRename && (
          <button
            type="button"
            aria-label={`Rename ${m.title}`}
            disabled={!canEdit}
            onClick={(e) => {
              e.preventDefault()
              setEditing({ id: m.id, kind: "rename", value: m.title })
            }}
          >
            ✎
          </button>
        )}
        {m !== undefined && onMove && (
          <button
            type="button"
            aria-label={`Move ${m.title}`}
            disabled={!canEdit}
            onClick={(e) => {
              e.preventDefault()
              setEditing({ id: m.id, kind: "move", value: m.path ?? "" })
            }}
          >
            🗀
          </button>
        )}
        {m !== undefined && onDelete && (
          <button
            type="button"
            aria-label={`Delete ${m.title}`}
            disabled={!canEdit}
            onClick={(e) => {
              e.preventDefault()
              onDelete(m.id)
            }}
          >
            ✕
          </button>
        )}
      </span>
    )
  }

  // A node with children is an expandable <details> (native, keyboard-accessible); a childless note
  // is a leaf row. Children are rendered in NFC name order.
  const renderNode = (node: TreeNode): ReactNode => {
    const children = [...node.children.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
    if (children.length > 0) {
      return (
        <details key={node.path} open className="node">
          <summary>{renderRow(node)}</summary>
          {children.map(renderNode)}
        </details>
      )
    }
    return (
      <div key={node.path} className="node node-leaf">
        {renderRow(node)}
      </div>
    )
  }

  return (
    <nav>
      <button type="button" onClick={onCreate} disabled={!canCreate}>
        New note
      </button>
      {[...buildTree(notes).children.values()]
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map(renderNode)}
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
