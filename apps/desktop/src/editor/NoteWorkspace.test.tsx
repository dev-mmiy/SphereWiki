import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { devAuth } from "../auth-dev"
import { NoteWorkspace } from "./NoteWorkspace"

describe("NoteWorkspace", () => {
  it("renders the note list, editor, and commit control", () => {
    render(<NoteWorkspace />)
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Home" })).toBeTruthy()
    expect(document.querySelector(".cm-editor")).not.toBeNull()
    expect(screen.getByRole("button", { name: /commit version/i })).toBeTruthy()
  })

  it("switches the active note from the list", () => {
    render(<NoteWorkspace />)
    const nav = screen.getByRole("navigation")
    fireEvent.click(within(nav).getByRole("button", { name: "Ideas" }))
    expect(document.querySelector(".cm-editor")).not.toBeNull()
  })

  it("commits a version when the Commit button is clicked (editor role)", () => {
    render(<NoteWorkspace />)
    expect(screen.queryAllByText(/revert/i)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: /commit version/i }))
    expect(screen.getAllByText(/revert/i).length).toBeGreaterThan(0)
  })

  it("shows the current user and enables editing for an editor", () => {
    render(<NoteWorkspace auth={devAuth("editor")} />)
    expect(screen.getByText(/you@local/)).toBeTruthy()
    expect(document.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true")
    expect(
      (screen.getByRole("button", { name: /commit version/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it("is read-only for a viewer", () => {
    render(<NoteWorkspace auth={devAuth("viewer")} />)
    expect(document.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false")
    expect(
      (screen.getByRole("button", { name: /commit version/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
    const nav = screen.getByRole("navigation")
    expect(
      (within(nav).getByRole("button", { name: /new note/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
