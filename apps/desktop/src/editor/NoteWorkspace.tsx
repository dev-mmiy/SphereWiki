import type { DiffChunk } from "@spherewiki/shared"
import { useState } from "react"
import { DiffView, HistoryPanel } from "./history-panel"
import { LinksPanel } from "./links-panel"
import { NoteEditor } from "./NoteEditor"
import { NoteList } from "./note-list"
import { useVaultWorkspace } from "./use-vault-workspace"

export function NoteWorkspace() {
  const ws = useVaultWorkspace()
  const [diff, setDiff] = useState<readonly DiffChunk[] | null>(null)
  const clearDiff = () => setDiff(null)

  return (
    <div className="workspace">
      <NoteList
        notes={ws.notes}
        activeId={ws.activeId}
        onSelect={(id) => {
          clearDiff()
          ws.select(id)
        }}
        onCreate={() => ws.create(`Note ${ws.notes.length + 1}`)}
      />
      {ws.activeNote && <NoteEditor key={ws.activeId} note={ws.activeNote} />}
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
