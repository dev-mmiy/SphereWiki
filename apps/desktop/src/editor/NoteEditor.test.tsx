import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NoteEditor } from "./NoteEditor"

describe("NoteEditor", () => {
  it("mounts a CodeMirror editor at runtime", () => {
    // Exercises the real runtime path: React mount → openYjsNote → CodeMirror
    // EditorView + markdown() + yCollab(ytext, null), all constructed in a DOM.
    const { container, unmount } = render(<NoteEditor />)
    expect(container.querySelector(".cm-editor")).not.toBeNull()
    expect(container.querySelector(".cm-content")).not.toBeNull()
    unmount()
  })
})
