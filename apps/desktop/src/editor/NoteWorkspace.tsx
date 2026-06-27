import type { OnSaveResult } from "@spherewiki/ai"
import { type AuthProvider, asNoteId, can, type DiffChunk, roleFor } from "@spherewiki/shared"
import { useState } from "react"
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
import { SearchPanel } from "./search-panel"
import { TagsPanel } from "./tags-panel"
import { ThemeToggle } from "./theme-toggle"
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
  const clearDiff = () => setDiff(null)

  const session = auth.session()
  const role = session ? roleFor(session, WORKSPACE_ID) : null
  const canWrite = session !== null && can(session, WORKSPACE_ID, "write")

  const runAi = (): void => {
    if (session === null) return
    void ws
      .aiOrganize(session)
      .then((r) => setAiStatus(describeResult(r)))
      .catch(() => setAiStatus("AI: run failed"))
  }

  return (
    <div className="workspace">
      <header>
        <span>{session ? `${session.account.email} · ${role ?? "no access"}` : "signed out"}</span>
        <ThemeToggle />
      </header>
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
      <SearchPanel
        search={ws.search}
        onNavigate={(id) => {
          clearDiff()
          setAiStatus(null)
          ws.select(asNoteId(id))
        }}
      />
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
          {ws.deleted.length > 0 && <p className="empty-hint">…or restore one from Trash above.</p>}
        </section>
      ) : (
        ws.activeNote && <NoteEditor key={ws.activeId} note={ws.activeNote} editable={canWrite} />
      )}
      <div className="ai-bar">
        <button type="button" onClick={runAi} disabled={!canWrite || ws.aiBusy}>
          Organize with AI
        </button>
        {aiStatus && <span className="ai-status">{aiStatus}</span>}
      </div>
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
      <MetricsPanel metrics={ws.metrics} ai={ws.aiMetrics} />
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
      <AskPanel
        canAsk={session !== null}
        onAsk={(query) => ws.aiAsk(query)}
        onNavigate={(title) => {
          clearDiff()
          setAiStatus(null)
          ws.selectByTitle(title)
        }}
      />
      {diff && <DiffView chunks={diff} />}
    </div>
  )
}
