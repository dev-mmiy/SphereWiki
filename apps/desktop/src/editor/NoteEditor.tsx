import type { YjsBackedNote } from "@spherewiki/shared"
import { useEffect, useRef } from "react"
import { mountEditor } from "./note-editor"

/** Renders a CodeMirror editor bound to the given note. The note is owned by the caller. */
export function NoteEditor({ note }: { note: YjsBackedNote }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const view = mountEditor(host, note)
    return () => view.destroy()
  }, [note])

  return <div ref={hostRef} />
}
