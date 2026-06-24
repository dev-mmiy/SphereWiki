import { markdown } from "@codemirror/lang-markdown"
import type { YjsBackedNote } from "@spherewiki/shared"
import { basicSetup, EditorView } from "codemirror"
import { yCollab } from "y-codemirror.next"

/**
 * Mount a CodeMirror 6 source editor bound to the note's Yjs text. This is the
 * engine seam: it is allowed to touch Yjs (via the note's `ytext`) because the
 * editor binding is inherently engine-specific. Everything else uses `CrdtNote`.
 *
 * `awareness` is null in M2 (single-user, no remote cursors yet).
 */
export function mountEditor(parent: HTMLElement, note: YjsBackedNote): EditorView {
  return new EditorView({
    parent,
    extensions: [basicSetup, markdown(), yCollab(note.ytext, null)],
  })
}
