import type { OnSaveResult } from "@spherewiki/ai"
import { type AuthProvider, can, type DiffChunk, roleFor } from "@spherewiki/shared"
import { useState } from "react"
import { devAuth, WORKSPACE_ID } from "../auth-dev"
import { connectRegistryToServer } from "../sync/connect-registry"
import { connectLocalPersistence } from "../sync/local-persistence"
import { connectRegistryPersistence } from "../sync/registry-persistence"
import { AskPanel } from "./ask-panel"
import { DiffView, HistoryPanel } from "./history-panel"
import { LinksPanel } from "./links-panel"
import { NoteEditor } from "./NoteEditor"
import { NoteList } from "./note-list"
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
  // Durable local vault (survives reload, offline); opt-in live sync via VITE_SYNC_URL.
  // When syncing, a local CRDT cache (IndexedDB) keeps the room readable offline.
  const ws = useVaultWorkspace({
    syncUrl: import.meta.env.VITE_SYNC_URL,
    persistVaultKey: `spherewiki:vault:${WORKSPACE_ID}`,
    localPersistence: connectLocalPersistence,
    connectRegistry: connectRegistryToServer,
    registryPersistence: connectRegistryPersistence,
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
        {session ? `${session.account.email} · ${role ?? "no access"}` : "signed out"}
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
      {ws.activeNote && <NoteEditor key={ws.activeId} note={ws.activeNote} editable={canWrite} />}
      <div className="ai-bar">
        <button type="button" onClick={runAi} disabled={!canWrite || ws.aiBusy}>
          Organize with AI
        </button>
        {aiStatus && <span className="ai-status">{aiStatus}</span>}
      </div>
      <LinksPanel
        outgoing={ws.outgoing}
        backlinks={ws.backlinks}
        onNavigate={(title) => {
          clearDiff()
          setAiStatus(null)
          ws.selectByTitle(title)
        }}
      />
      <TagsPanel
        key={ws.activeId}
        tags={ws.tags}
        activeId={ws.activeId}
        notesForTag={ws.notesForTag}
        onNavigate={(id) => {
          clearDiff()
          setAiStatus(null)
          ws.select(id)
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
