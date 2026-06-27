import type { YjsBackedNote } from "@spherewiki/shared"
import { useEffect, useRef } from "react"
import { mountEditor } from "./note-editor"

/**
 * Renders a CodeMirror editor bound to the given note. The note is owned by the caller. `titles`
 * (the workspace's note titles) drive `[[wikilink]]` autocomplete; they're read through a ref so a
 * changing list never remounts the editor (which would drop cursor/undo state).
 */
export function NoteEditor({
  note,
  editable = true,
  titles = [],
}: {
  note: YjsBackedNote
  editable?: boolean
  titles?: readonly string[]
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const titlesRef = useRef(titles)
  titlesRef.current = titles // keep current without re-running the mount effect

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const view = mountEditor(host, note, { editable, getTitles: () => titlesRef.current })
    return () => view.destroy()
  }, [note, editable])

  return <div ref={hostRef} />
}
