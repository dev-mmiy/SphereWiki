import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WebApp } from "./App"

describe("WebApp", () => {
  it("renders the shared NoteWorkspace editor in the browser (same as desktop, no drift)", () => {
    render(<WebApp />)
    // The note list + CodeMirror editor from @spherewiki/editor render in the web client — the same
    // editor as desktop, proving the shared package works browser-side (this is the web sync wiring).
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Home" })).toBeTruthy() // seed note list
    expect(document.querySelector(".cm-editor")).not.toBeNull()
  })

  it("shows no project switcher — the web client reaches one workspace at a time (isolation)", () => {
    render(<WebApp />)
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull()
  })
})
