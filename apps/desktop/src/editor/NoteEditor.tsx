import { openYjsNote } from "@spherewiki/shared"
import { useEffect, useRef } from "react"
import { mountEditor } from "./note-editor"

const SAMPLE = "# Welcome to SphereWiki\n\nStart typing — this editor is backed by a CRDT.\n"

export function NoteEditor() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const note = openYjsNote()
    note.setText(SAMPLE, { actor: "local", kind: "human" })
    const view = mountEditor(host, note)

    return () => {
      view.destroy()
      note.destroy()
    }
  }, [])

  return <div ref={hostRef} />
}
