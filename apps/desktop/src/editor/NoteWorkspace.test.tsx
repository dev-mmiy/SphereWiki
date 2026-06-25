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

  it("offers Organize with AI for an editor and disables it for a viewer", () => {
    const { unmount } = render(<NoteWorkspace auth={devAuth("editor")} />)
    expect(
      (screen.getByRole("button", { name: /organize with ai/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
    unmount()
    render(<NoteWorkspace auth={devAuth("viewer")} />)
    expect(
      (screen.getByRole("button", { name: /organize with ai/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("runs the agent, surfaces what it added, and attributes it in history", async () => {
    render(<NoteWorkspace auth={devAuth("editor")} />)
    fireEvent.click(screen.getByRole("button", { name: /organize with ai/i }))
    expect(await screen.findByText(/AI added/)).toBeTruthy()
    expect(screen.getByText(/ai:on-save/)).toBeTruthy() // the AI version, attributed in history
  })

  it("answers a workspace question with cited notes (RAG)", async () => {
    render(<NoteWorkspace auth={devAuth("editor")} />)
    fireEvent.change(screen.getByLabelText(/ask the workspace/i), {
      target: { value: "auto links notes" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }))
    const region = await screen.findByRole("region", { name: "Ask" })
    expect(await within(region).findByRole("button", { name: "Ideas" })).toBeTruthy()
  })

  it("deletes a note to the trash and restores it", () => {
    render(<NoteWorkspace auth={devAuth("editor")} />)
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
    fireEvent.click(within(nav).getByRole("button", { name: "Delete Ideas" }))
    expect(within(nav).queryByRole("button", { name: "Ideas" })).toBeNull() // gone from the list
    // Restorable from the trash.
    fireEvent.click(within(nav).getByRole("button", { name: "Restore Ideas" }))
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
  })

  it("disables delete for a viewer", () => {
    render(<NoteWorkspace auth={devAuth("viewer")} />)
    const nav = screen.getByRole("navigation")
    expect(
      (within(nav).getByRole("button", { name: "Delete Ideas" }) as HTMLButtonElement).disabled,
    ).toBe(true)
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
