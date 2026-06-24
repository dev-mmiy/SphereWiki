import type { YjsBackedNote } from "@spherewiki/shared"
import { useEffect, useRef } from "react"
import { mountEditor } from "./note-editor"

/** Renders a CodeMirror editor bound to the given note. The note is owned by the caller. */
export function NoteEditor({ note, editable = true }: { note: YjsBackedNote; editable?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const view = mountEditor(host, note, { editable })
    return () => view.destroy()
  }, [note, editable])

  return <div ref={hostRef} />
}
