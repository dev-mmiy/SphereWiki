import { type AuthProvider, can, type DiffChunk, roleFor } from "@spherewiki/shared"
import { useState } from "react"
import { devAuth, WORKSPACE_ID } from "../auth-dev"
import { DiffView, HistoryPanel } from "./history-panel"
import { LinksPanel } from "./links-panel"
import { NoteEditor } from "./NoteEditor"
import { NoteList } from "./note-list"
import { useVaultWorkspace } from "./use-vault-workspace"

export function NoteWorkspace({ auth = devAuth() }: { auth?: AuthProvider }) {
  const ws = useVaultWorkspace()
  const [diff, setDiff] = useState<readonly DiffChunk[] | null>(null)
  const clearDiff = () => setDiff(null)

  const session = auth.session()
  const role = session ? roleFor(session, WORKSPACE_ID) : null
  const canWrite = session !== null && can(session, WORKSPACE_ID, "write")

  return (
    <div className="workspace">
      <header>
        {session ? `${session.account.email} · ${role ?? "no access"}` : "signed out"}
      </header>
      <NoteList
        notes={ws.notes}
        activeId={ws.activeId}
        canCreate={canWrite}
        onSelect={(id) => {
          clearDiff()
          ws.select(id)
        }}
        onCreate={() => ws.create(`Note ${ws.notes.length + 1}`)}
      />
      {ws.activeNote && <NoteEditor key={ws.activeId} note={ws.activeNote} editable={canWrite} />}
      <LinksPanel
        outgoing={ws.outgoing}
        backlinks={ws.backlinks}
        onNavigate={(title) => {
          clearDiff()
          ws.selectByTitle(title)
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
      {diff && <DiffView chunks={diff} />}
    </div>
  )
}
