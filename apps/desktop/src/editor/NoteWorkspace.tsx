import type { DiffChunk, EditOrigin } from "@spherewiki/shared"
import { useState } from "react"
import { DiffView, HistoryPanel } from "./history-panel"
import { NoteEditor } from "./NoteEditor"
import { useNoteSession } from "./use-note-session"

const SAMPLE = "# Welcome to SphereWiki\n\nStart typing — this editor is backed by a CRDT.\n"
const LOCAL: EditOrigin = { actor: "local", kind: "human" }

export function NoteWorkspace() {
  const session = useNoteSession(SAMPLE)
  const [diff, setDiff] = useState<readonly DiffChunk[] | null>(null)

  return (
    <div className="workspace">
      <NoteEditor note={session.note} />
      <HistoryPanel
        versions={session.versions}
        onCommit={() => session.commit(LOCAL)}
        onRevert={(id) => {
          session.revert(id, LOCAL)
          setDiff(null)
        }}
        onDiff={(id) => setDiff(session.diffAgainstCurrent(id))}
      />
      {diff && <DiffView chunks={diff} />}
    </div>
  )
}
