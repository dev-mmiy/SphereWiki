import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { markdown } from "@codemirror/lang-markdown"
import { wikilinkSuggestions, type YjsBackedNote } from "@spherewiki/shared"
import { basicSetup, EditorView } from "codemirror"
import { yCollab } from "y-codemirror.next"

// Matches an open `[[` with the (bracket/newline-free) text typed after it, ending at the cursor.
const WIKILINK_BEFORE = /\[\[([^[\]\n]*)$/

/**
 * A CodeMirror completion source for `[[wikilink]]` note titles. It fires only inside an open `[[`,
 * ranks the workspace's titles via the shared `wikilinkSuggestions` (so the logic is engine-agnostic
 * and unit-tested), and accepting an option inserts the title plus the closing `]]`. `getTitles` is
 * read lazily on each query so the list stays current without remounting the editor.
 */
export function wikilinkCompletionSource(
  getTitles: () => readonly string[],
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const before = context.matchBefore(WIKILINK_BEFORE)
    if (!before) return null
    const typed = before.text.slice(2) // drop the leading "[["
    // Don't pop up on a bare `[[` while typing — only when the user explicitly asks (Ctrl-Space).
    if (typed === "" && !context.explicit) return null
    const options = wikilinkSuggestions(getTitles(), typed).map((title) => ({
      label: title,
      type: "text",
      apply: `${title}]]`,
    }))
    if (options.length === 0) return null
    return { from: before.from + 2, options, validFor: /^[^[\]\n]*$/ }
  }
}

/**
 * Mount a CodeMirror 6 source editor bound to the note's Yjs text. This is the
 * engine seam: it may touch Yjs (via `ytext`) because the editor binding is
 * inherently engine-specific. `editable` reflects the viewer's write permission.
 * `getTitles`, when given, enables `[[wikilink]]` title autocomplete.
 * `awareness` is null in M2 (single-user, no remote cursors yet).
 */
export function mountEditor(
  parent: HTMLElement,
  note: YjsBackedNote,
  options: { editable?: boolean; getTitles?: () => readonly string[] } = {},
): EditorView {
  const extensions = [
    basicSetup,
    markdown(),
    yCollab(note.ytext, null),
    EditorView.editable.of(options.editable ?? true),
  ]
  if (options.getTitles) {
    extensions.push(autocompletion({ override: [wikilinkCompletionSource(options.getTitles)] }))
  }
  return new EditorView({ parent, extensions })
}
