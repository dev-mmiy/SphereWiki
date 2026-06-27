import type { Autonomy, OnSaveResult } from "@spherewiki/ai"
import { type AuthProvider, asNoteId, can, type DiffChunk, roleFor } from "@spherewiki/shared"
import { CollapsiblePanel, ThemeToggle } from "@spherewiki/ui"
import { useEffect, useState } from "react"
import { appTitle } from "../app-info"
import { devAuth, WORKSPACE_ID } from "../auth-dev"
import { createAiMetricsRecorder } from "../metrics/ai-metrics"
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
import { QuickSwitcher } from "./quick-switcher"
import { SearchPanel } from "./search-panel"
import { SuggestionsReview } from "./suggestions-review"
import { SyncStatus } from "./sync-status"
import { TagsPanel } from "./tags-panel"
import { useVaultWorkspace } from "./use-vault-workspace"

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

export function NoteWorkspace({ auth = devAuth() }: { auth?: AuthProvider }) {
  // Kept-vs-reverted counters persist (localStorage) so they accumulate across sessions. Keyed by
  // the single dev WORKSPACE_ID today; when real multi-workspace switching lands, derive this key
  // from the same workspaceId the hook uses so per-workspace metrics never share a bucket.
  const [aiMetricsRecorder] = useState(() =>
    createAiMetricsRecorder({
      storage: window.localStorage,
      key: `spherewiki:aimetrics:${WORKSPACE_ID}`,
    }),
  )
  // Durable local vault (survives reload, offline); opt-in live sync via VITE_SYNC_URL.
  // When syncing, a local CRDT cache (IndexedDB) keeps the room readable offline.
  const ws = useVaultWorkspace({
    syncUrl: import.meta.env.VITE_SYNC_URL,
    persistVaultKey: `spherewiki:vault:${WORKSPACE_ID}`,
    localPersistence: connectLocalPersistence,
    connectRegistry: connectRegistryToServer,
    registryPersistence: connectRegistryPersistence,
    aiMetricsRecorder,
  })
  const [diff, setDiff] = useState<readonly DiffChunk[] | null>(null)
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  // Pending AI suggestions awaiting human confirmation (suggest mode). `pendingKey` bumps per run
  // so the review panel remounts with a fresh (all-checked) selection for each new suggestion set.
  const [pending, setPending] = useState<OnSaveResult["suggested"] | null>(null)
  const [pendingKey, setPendingKey] = useState(0)
  // Focus mode: either side pane can be folded away to widen the editor (and to stay usable in a
  // narrow window). Both default open.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [railOpen, setRailOpen] = useState(true)
  const clearDiff = () => setDiff(null)

  // Cmd/Ctrl-K toggles the quick switcher (keyboard-first "jump to note").
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        setQuickOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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
                ws.select(id)
              }}
              onCreate={() => ws.create(`Note ${ws.notes.length + 1}`)}
              onDelete={(id) => {
                clearDiff()
                setAiStatus(null)
                ws.remove(id)
              }}
              onRename={(id) => {
                const current = ws.notes.find((m) => m.id === id)?.title ?? ""
                const next = window.prompt("Rename note", current)
                if (next === null || next.trim() === "") return
                clearDiff()
                setAiStatus(null)
                ws.rename(id, next)
              }}
              onRestore={(id) => ws.restore(id)}
            />
          </aside>
        )}

        <main className="editor-pane">
          {ws.notes.length === 0 ? (
            <section className="empty-state" aria-label="Empty workspace">
              <p>No notes yet.</p>
              <button
                type="button"
                disabled={!canWrite}
                onClick={() => {
                  clearDiff()
                  setAiStatus(null)
                  ws.create("Untitled")
                }}
              >
                Create your first note
              </button>
              {ws.deleted.length > 0 && (
                <p className="empty-hint">…or restore one from the Trash.</p>
              )}
            </section>
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
              <MetricsPanel metrics={ws.metrics} ai={ws.aiMetrics} />
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
    </div>
  )
}
