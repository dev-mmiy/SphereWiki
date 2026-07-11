import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { type EditOrigin, openYjsNote } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { mountEditor, wikilinkCompletionSource } from "./note-editor"

const LOCAL: EditOrigin = { actor: "local", kind: "human" }

const TITLES = ["Home", "Roadmap", "Road trip"]

/**
 * A minimal `CompletionContext` stub. The source only uses `matchBefore(regex)` and `explicit`, so
 * we simulate the text-before-cursor on a single line at a given offset instead of standing up a
 * whole EditorState.
 */
function ctx(textBeforeCursor: string, explicit = false): CompletionContext {
  const pos = textBeforeCursor.length
  return {
    explicit,
    pos,
    matchBefore(re: RegExp) {
      const m = textBeforeCursor.match(re)
      if (!m) return null
      const from = pos - m[0].length
      return { from, to: pos, text: m[0] }
    },
  } as unknown as CompletionContext
}

function complete(text: string, explicit = false): CompletionResult | null {
  return wikilinkCompletionSource(() => TITLES)(ctx(text, explicit))
}

describe("wikilinkCompletionSource", () => {
  it("returns null when the cursor is not inside an open [[", () => {
    expect(complete("just some text")).toBeNull()
    expect(complete("a [[Done]] link")).toBeNull() // closed link — no trailing open [[
  })

  it("suggests ranked titles for an open [[ with typed text, anchored after the brackets", () => {
    const result = complete("see [[road")
    expect(result).not.toBeNull()
    expect(result?.options.map((o) => o.label)).toEqual(["Roadmap", "Road trip"])
    // `from` points just past the `[[` (offset of the `r` in "road").
    expect(result?.from).toBe("see [[".length)
  })

  it("accepting an option inserts the title plus the closing ]]", () => {
    const result = complete("[[Ro")
    expect(result?.options[0]).toMatchObject({ label: "Roadmap", apply: "Roadmap]]" })
  })

  it("stays quiet on a bare [[ while typing, but lists everything when explicitly invoked", () => {
    expect(complete("[[")).toBeNull()
    const result = complete("[[", true)
    expect(result?.options.map((o) => o.label)).toEqual(TITLES)
  })

  it("returns null when nothing matches", () => {
    expect(complete("[[zzz")).toBeNull()
  })
})

describe("mountEditor", () => {
  it("initializes the editor doc from the note's existing content (not an empty doc)", () => {
    // y-codemirror.next only syncs *future* ytext changes — the EditorState doc must be seeded with
    // the current text, or the editor opens EMPTY while the note has content, and the first
    // keystroke inserts at position 0 and corrupts the note.
    const note = openYjsNote()
    note.setText("# Home\n\nWelcome.", LOCAL)
    const parent = document.createElement("div")
    const view = mountEditor(parent, note)
    try {
      expect(view.state.doc.toString()).toBe("# Home\n\nWelcome.")
    } finally {
      view.destroy()
      note.destroy()
    }
  })

  it("keeps the editor in sync with later note changes (binding intact)", () => {
    const note = openYjsNote()
    note.setText("start", LOCAL)
    const parent = document.createElement("div")
    const view = mountEditor(parent, note)
    try {
      note.setText("start changed", LOCAL)
      expect(view.state.doc.toString()).toBe("start changed")
    } finally {
      view.destroy()
      note.destroy()
    }
  })
})
