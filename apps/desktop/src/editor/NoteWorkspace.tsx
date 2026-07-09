import type { Autonomy, EmbeddingProvider, OnSaveResult, VectorIndex } from "@spherewiki/ai"
import {
  type AuthProvider,
  asNoteId,
  can,
  type DiffChunk,
  type NoteId,
  normalizeFolder,
  roleFor,
  type Vault,
} from "@spherewiki/shared"
import { CollapsiblePanel, ThemeToggle } from "@spherewiki/ui"
import { useEffect, useState } from "react"
import { appTitle } from "../app-info"
import { localAuth, WORKSPACE_ID } from "../auth-local"
import { createAiMetricsRecorder } from "../metrics/ai-metrics"
import { createGraphBaselineRecorder, graphSnapshot } from "../metrics/graph-growth"
import type { SyncStorage } from "../state/disk-storage"
import { connectRegistryToServer } from "../sync/connect-registry"
import { connectLocalPersistence } from "../sync/local-persistence"
import { connectRegistryPersistence } from "../sync/registry-persistence"
import { AskPanel } from "./ask-panel"
import { GraphView } from "./graph-view"
import { DiffView, HistoryPanel } from "./history-panel"
import { LinksPanel } from "./links-panel"
import { MetricsPanel } from "./metrics-panel"
import { NoteEditor } from "./NoteEditor"
import { NoteList } from "./note-list"
import { freshNoteTitle } from "./note-title"
import { QuickSwitcher } from "./quick-switcher"
import { SearchPanel } from "./search-panel"
import { ShortcutHelp } from "./shortcut-help"
import { SuggestionsReview } from "./suggestions-review"
import { SyncStatus } from "./sync-status"
import { TagsPanel } from "./tags-panel"
import { useVaultWorkspace } from "./use-vault-workspace"
import { WelcomePanel } from "./welcome-panel"

/** True when a keystroke is being typed into a field/editor, so bare-key shortcuts must stand down. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (el === null) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable
}

/** One-line summary of an agent run for the status area. */
function describeResult(r: OnSaveResult): string {
  if (r.applied) {
    return `AI added ${r.links.length.toString()} link(s), ${r.tags.length.toString()} tag(s)`
  }
  switch (r.skippedReason) {
    case "no-permission":
      return "AI: no write permission"
    case "autonomy-off":
      return "AI is turned off"
    case "autonomy-suggest":
      return `AI suggests ${(r.suggested?.links.length ?? 0).toString()} link(s), ${(r.suggested?.tags.length ?? 0).toString()} tag(s)`
    default:
      return "AI: nothing to add"
  }
}

export function NoteWorkspace({
  auth = localAuth(),
  vault,
  index,
  embedder,
  storage,
}: {
  auth?: AuthProvider
  /** The on-disk backend under the native shell (App awaits its hydration first); web omits these. */
  vault?: Vault
  index?: VectorIndex
  embedder?: EmbeddingProvider
  /** Durable-state store: the on-disk `.spherewiki/` sidecar under Tauri, else webview localStorage. */
  storage?: SyncStorage
}) {
  // Under the native shell all NON-derived durable state (version history, session prefs, AI metrics,
  // graph baseline) goes through the on-disk `.spherewiki/` sidecar so it travels with the vault
  // folder; in the browser it stays in webview localStorage.
  const durable = storage ?? window.localStorage
  // Kept-vs-reverted counters persist so they accumulate across sessions. Keyed by the local-mode
  // WORKSPACE_ID today; when real multi-workspace switching lands, derive this key from the same
  // workspaceId the hook uses so per-workspace metrics never share a bucket.
  const [aiMetricsRecorder] = useState(() =>
    createAiMetricsRecorder({
      storage: durable,
      key: `spherewiki:aimetrics:${WORKSPACE_ID}`,
    }),
  )
  // Baseline for the "graph growth" dogfooding signal: captured once per workspace (after
  // hydration), persisted so the metrics panel shows growth since the workspace was first opened.
  const [graphBaseline] = useState(() =>
    createGraphBaselineRecorder({
      storage: durable,
      key: `spherewiki:graphbaseline:${WORKSPACE_ID}`,
    }),
  )
  // Durable local vault (survives reload, offline); opt-in live sync via VITE_SYNC_URL.
  // When syncing, a local CRDT cache (IndexedDB) keeps the room readable offline.
  const ws = useVaultWorkspace({
    ...(vault !== undefined ? { vault } : {}),
    ...(index !== undefined ? { index } : {}),
    ...(embedder !== undefined ? { embedder } : {}),
    ...(storage !== undefined ? { vaultStorage: storage } : {}),
    syncUrl: import.meta.env.VITE_SYNC_URL,
    syncToken: import.meta.env.VITE_SYNC_TOKEN,
    persistVaultKey: `spherewiki:vault:${WORKSPACE_ID}`,
    persistVersionsKey: `spherewiki:versions:${WORKSPACE_ID}`,
    persistSessionKey: `spherewiki:session:${WORKSPACE_ID}`,
    localPersistence: connectLocalPersistence,
    connectRegistry: connectRegistryToServer,
    registryPersistence: connectRegistryPersistence,
    aiMetricsRecorder,
  })
  const [diff, setDiff] = useState<readonly DiffChunk[] | null>(null)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Pending AI suggestions awaiting human confirmation (suggest mode). `pendingKey` bumps per run
  // so the review panel remounts with a fresh (all-checked) selection for each new suggestion set.
  const [pending, setPending] = useState<OnSaveResult["suggested"] | null>(null)
  const [pendingKey, setPendingKey] = useState(0)
  // Focus mode: either side pane can be folded away to widen the editor (and to stay usable in a
  // narrow window). Both default open.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [railOpen, setRailOpen] = useState(true)
  const clearDiff = () => setDiff(null)

  // --- First-class Folders (📁 containers, distinct from notes) ---
  // Non-empty folders come from note paths; EMPTY folders are tracked here + persisted to the
  // `.spherewiki/` sidecar (via `durable`) so they survive a reload and travel with the vault.
  const foldersKey = `spherewiki:folders:${WORKSPACE_ID}`
  const [emptyFolders, setEmptyFolders] = useState<readonly string[]>(() => {
    try {
      const raw = durable.getItem(foldersKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      durable.setItem(foldersKey, JSON.stringify(emptyFolders))
    } catch {
      // Best-effort (like the rest of the durable sidecar): if storage is unavailable, empty folders
      // simply don't persist across a reload — non-empty folders still live in the note paths.
    }
  }, [durable, foldersKey, emptyFolders])
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  // Navigating to a NOTE (from the list, search, quick-switcher, a link, the graph, tags, ask…) clears
  // the folder creation context — so a new note/folder lands where you're now looking, never in a
  // stale folder. Selecting a folder doesn't change activeId, so the folder stays selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs on an activeId change to reset the context, though the body doesn't read it.
  useEffect(() => {
    setSelectedFolder(null)
  }, [ws.activeId])
  const activeNote = ws.notes.find((m) => m.id === ws.activeId)
  // Creation targets UNDER the current selection: the selected folder (a note/folder lands inside it),
  // else the active note's OWN children folder `<path>/<name>` (so the new item nests under that note,
  // making it a folder-parent), else the vault root. A fresh title free of BOTH visible and trashed
  // notes so create never resolves-by-title to, or restores, an existing note.
  const contextFolder =
    selectedFolder ??
    (activeNote?.name !== undefined
      ? activeNote.path
        ? `${activeNote.path}/${activeNote.name}`
        : activeNote.name
      : "")
  const freshTitle = () => freshNoteTitle([...ws.notes, ...ws.deleted].map((m) => m.title))
  const createFolderInContext = () => {
    // Names already in use directly under contextFolder — so "New folder N" never silently reuses one:
    // sibling empty folders, notes sitting here, AND non-empty subfolders (a note deeper down whose
    // first segment below contextFolder is that subfolder's name).
    const taken = new Set<string>(
      emptyFolders
        .filter((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "") === contextFolder)
        .map((f) => f.slice(f.lastIndexOf("/") + 1)),
    )
    for (const m of ws.notes) {
      const p = m.path ?? ""
      if (p === contextFolder) {
        taken.add(m.name ?? m.title) // a note sitting directly in the context folder
      } else if (contextFolder === "" ? p !== "" : p.startsWith(`${contextFolder}/`)) {
        const rest = contextFolder === "" ? p : p.slice(contextFolder.length + 1)
        taken.add(rest.split("/")[0] as string) // a non-empty subfolder's own name
      }
    }
    let name = "New folder"
    let n = 1
    while (taken.has(name)) {
      n += 1
      name = `New folder ${n}`
    }
    const path = contextFolder ? `${contextFolder}/${name}` : name
    setEmptyFolders((prev) => (prev.includes(path) ? prev : [...prev, path])) // no double entry
    setSelectedFolder(path) // focus the new folder so the next create nests into it
  }

  // Rewrite the folder registry + selection when a folder at `oldPath` is renamed/moved to `newPath`
  // (both its own entry and any subfolder under it), or DELETED when `newPath` is null.
  const rewriteFolderPaths = (oldPath: string, newPath: string | null): void => {
    const under = `${oldPath}/`
    // Dedupe (Set): merging a folder onto an existing path would otherwise leave a duplicate entry.
    setEmptyFolders((prev) => [
      ...new Set(
        prev.flatMap((f) => {
          if (f === oldPath) return newPath === null ? [] : [newPath]
          if (f.startsWith(under))
            return newPath === null ? [] : [`${newPath}${f.slice(oldPath.length)}`]
          return [f]
        }),
      ),
    ])
    setSelectedFolder((sel) => {
      if (sel === null) return null
      if (sel === oldPath) return newPath
      if (sel.startsWith(under))
        return newPath === null ? null : `${newPath}${sel.slice(oldPath.length)}`
      return sel
    })
  }
  const renameFolder = (oldPath: string, rawName: string): void => {
    const name = normalizeFolder(rawName) // a safe single segment (or path); "" is a no-op
    if (name === "") return
    const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : ""
    const newPath = parent ? `${parent}/${name}` : name
    if (newPath === oldPath) return
    ws.moveFolder(oldPath, newPath) // relocate the contained notes
    rewriteFolderPaths(oldPath, newPath)
  }
  const moveFolderTo = (oldPath: string, rawParent: string): void => {
    const parent = normalizeFolder(rawParent) // target parent dir ("" = root)
    const folderName = oldPath.slice(oldPath.lastIndexOf("/") + 1)
    const newPath = parent ? `${parent}/${folderName}` : folderName
    // Refuse moving into itself / its own subtree, and no-op if unchanged.
    if (newPath === oldPath || parent === oldPath || parent.startsWith(`${oldPath}/`)) return
    ws.moveFolder(oldPath, newPath)
    rewriteFolderPaths(oldPath, newPath)
  }
  const deleteFolder = (path: string): void => {
    // Trash every note in the folder (recoverable via Trash), then drop the folder + its subfolders.
    const under = `${path}/`
    for (const m of ws.notes) {
      const p = m.path ?? ""
      if (p === path || p.startsWith(under)) ws.remove(m.id)
    }
    rewriteFolderPaths(path, null)
  }

  // Global keyboard shortcuts: Cmd/Ctrl-K jump-to-note, Cmd/Ctrl-B fold the sidebar (focus mode),
  // and "?" for the shortcut help. "?" is a bare key, so it stands down while the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "?" && !isEditableTarget(e.target)) {
        e.preventDefault()
        setHelpOpen((o) => !o)
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === "k") {
        e.preventDefault()
        setQuickOpen((o) => !o)
      } else if (key === "b") {
        e.preventDefault()
        setSidebarOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Capture the graph baseline once the workspace has hydrated (so a transient pre-sync empty graph
  // can't be mistaken for the baseline). `ensure` is idempotent — only the first call sticks.
  useEffect(() => {
    if (ws.hydrated) graphBaseline.ensure(graphSnapshot(ws.metrics))
  }, [ws.hydrated, ws.metrics, graphBaseline])
  const graphGrowth = graphBaseline.growth(graphSnapshot(ws.metrics))

  const session = auth.session()
  const role = session ? roleFor(session, WORKSPACE_ID) : null
  const canWrite = session !== null && can(session, WORKSPACE_ID, "write")

  const runAi = (): void => {
    if (session === null) return
    void ws
      .aiOrganize(session)
      .then((r) => {
        setAiStatus(describeResult(r))
        // Suggest mode surfaces candidates for review instead of applying them.
        if (r.skippedReason === "autonomy-suggest" && r.suggested) {
          setPending(r.suggested)
          setPendingKey((k) => k + 1)
        } else {
          setPending(null)
        }
      })
      .catch(() => setAiStatus("AI: run failed"))
  }

  const applySuggestions = (selection: { links: string[]; tags: string[] }): void => {
    if (session === null) return
    void ws
      .aiApplySuggestions(session, selection)
      .then((r) => {
        setAiStatus(describeResult(r))
        setPending(null)
      })
      .catch(() => setAiStatus("AI: apply failed"))
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="pane-toggle"
          aria-label="Toggle sidebar"
          aria-pressed={sidebarOpen}
          title="Toggle sidebar (⌘/Ctrl-B)"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          ◧
        </button>
        <h1 className="brand">{appTitle()}</h1>
        <div className="topbar-meta">
          <SyncStatus status={ws.syncStatus} />
          <span className="who">
            {session ? `${session.account.email} · ${role ?? "no access"}` : "signed out"}
          </span>
          <ThemeToggle />
          <button
            type="button"
            className="pane-toggle"
            aria-label="Toggle details panel"
            aria-pressed={railOpen}
            onClick={() => setRailOpen((o) => !o)}
          >
            ◨
          </button>
        </div>
      </header>

      <div className="panes" data-sidebar={sidebarOpen} data-rail={railOpen}>
        {sidebarOpen && (
          <aside className="sidebar">
            <SearchPanel
              search={ws.search}
              onNavigate={(id) => {
                clearDiff()
                setAiStatus(null)
                ws.select(asNoteId(id))
              }}
            />
            <NoteList
              notes={ws.notes}
              activeId={ws.activeId}
              canCreate={canWrite}
              canEdit={canWrite}
              deleted={ws.deleted}
              onSelect={(id) => {
                clearDiff()
                setAiStatus(null)
                ws.select(id) // clears the folder context via the activeId effect above
              }}
              // "New note" — a document UNDER the current selection (inside the selected folder, or
              // under the active note as a child, else at root).
              onCreate={() => {
                clearDiff()
                setAiStatus(null)
                ws.create(freshTitle(), contextFolder)
              }}
              onDelete={(id) => {
                clearDiff()
                setAiStatus(null)
                ws.remove(id)
              }}
              onRename={(id, title) => {
                clearDiff()
                setAiStatus(null)
                ws.rename(id, title)
              }}
              {...(ws.canMove
                ? {
                    folders: emptyFolders,
                    selectedFolder,
                    onSelectFolder: (path: string) => {
                      clearDiff()
                      setSelectedFolder(path)
                    },
                    onMove: (id: NoteId, folder: string) => {
                      ws.move(id, folder)
                    },
                    // "New folder" — an empty 📁 container UNDER the current selection.
                    onCreateFolder: createFolderInContext,
                    onRenameFolder: renameFolder,
                    onMoveFolder: moveFolderTo,
                    onDeleteFolder: deleteFolder,
                  }
                : {})}
              onRestore={(id) => ws.restore(id)}
            />
          </aside>
        )}

        <main className="editor-pane">
          {ws.notes.length === 0 ? (
            <WelcomePanel
              canCreate={canWrite}
              deletedCount={ws.deleted.length}
              onCreate={() => {
                clearDiff()
                setAiStatus(null)
                ws.create("Untitled")
              }}
              onShowShortcuts={() => setHelpOpen(true)}
            />
          ) : (
            ws.activeNote && (
              <NoteEditor
                key={ws.activeId}
                note={ws.activeNote}
                editable={canWrite}
                titles={ws.notes.map((n) => n.title)}
              />
            )
          )}
          <div className="ai-bar">
            <button type="button" onClick={runAi} disabled={!canWrite || ws.aiBusy}>
              Organize with AI
            </button>
            <label className="ai-mode">
              Mode
              <select
                aria-label="AI mode"
                value={ws.aiAutonomy}
                onChange={(e) => {
                  ws.setAiAutonomy(e.target.value as Autonomy)
                  setPending(null) // a mode change supersedes any pending review
                }}
              >
                <option value="off">Off</option>
                <option value="suggest">Suggest</option>
                <option value="auto">Auto</option>
              </select>
            </label>
            {aiStatus && <span className="ai-status">{aiStatus}</span>}
          </div>
          {pending && (
            <SuggestionsReview
              key={pendingKey}
              suggested={pending}
              busy={ws.aiBusy}
              onApply={applySuggestions}
              onDismiss={() => setPending(null)}
            />
          )}
          {diff && <DiffView chunks={diff} />}
        </main>

        {railOpen && (
          <aside className="rail">
            <CollapsiblePanel title="Links">
              <LinksPanel
                outgoing={ws.outgoing}
                backlinks={ws.backlinks}
                canCreate={canWrite}
                onNavigate={(title) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.selectByTitle(title)
                }}
                onCreate={(title) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.create(title)
                }}
              />
            </CollapsiblePanel>
            <CollapsiblePanel title="Tags">
              <TagsPanel
                key={ws.activeId}
                tags={ws.tags}
                activeId={ws.activeId}
                canEdit={canWrite && ws.activeNote !== null && ws.hydrated}
                notesForTag={ws.notesForTag}
                onNavigate={(id) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.select(id)
                }}
                onAddTag={(tag) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.addTag(tag)
                }}
                onRemoveTag={(tag) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.removeTag(tag)
                }}
              />
            </CollapsiblePanel>
            <CollapsiblePanel title="Workspace">
              <MetricsPanel metrics={ws.metrics} ai={ws.aiMetrics} growth={graphGrowth} />
            </CollapsiblePanel>
            <CollapsiblePanel title="Graph">
              <GraphView
                nodes={ws.graph.nodes}
                edges={ws.graph.edges}
                activeId={ws.activeId}
                canCreate={canWrite}
                onNavigate={(id) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.select(asNoteId(id))
                }}
                onCreate={(title) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.create(title)
                }}
              />
            </CollapsiblePanel>
            <CollapsiblePanel title="History">
              <HistoryPanel
                versions={ws.versions}
                canEdit={canWrite}
                onCommit={() => ws.commit()}
                onRevert={(id) => {
                  ws.revert(id)
                  clearDiff()
                }}
                onDiff={(id) => setDiff(ws.diffAgainstCurrent(id))}
              />
            </CollapsiblePanel>
            <CollapsiblePanel title="Ask">
              <AskPanel
                canAsk={session !== null}
                onAsk={(query) => ws.aiAsk(query)}
                onNavigate={(title) => {
                  clearDiff()
                  setAiStatus(null)
                  ws.selectByTitle(title)
                }}
              />
            </CollapsiblePanel>
          </aside>
        )}
      </div>

      <QuickSwitcher
        open={quickOpen}
        notes={ws.notes}
        search={ws.search}
        onNavigate={(id) => {
          clearDiff()
          setAiStatus(null)
          ws.select(asNoteId(id))
        }}
        onClose={() => setQuickOpen(false)}
      />

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
