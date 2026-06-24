import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NoteWorkspace } from "./NoteWorkspace"

describe("NoteWorkspace", () => {
  it("renders the note list, editor, and commit control", () => {
    render(<NoteWorkspace />)
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Home" })).toBeTruthy()
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
    expect(document.querySelector(".cm-editor")).not.toBeNull()
    expect(screen.getByRole("button", { name: /commit version/i })).toBeTruthy()
  })

  it("switches the active note from the list", () => {
    render(<NoteWorkspace />)
    const nav = screen.getByRole("navigation")
    fireEvent.click(within(nav).getByRole("button", { name: "Ideas" }))
    expect(document.querySelector(".cm-editor")).not.toBeNull()
  })

  it("commits a version when the Commit button is clicked", () => {
    render(<NoteWorkspace />)
    expect(screen.queryAllByText(/revert/i)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: /commit version/i }))
    expect(screen.getAllByText(/revert/i).length).toBeGreaterThan(0)
  })
})
