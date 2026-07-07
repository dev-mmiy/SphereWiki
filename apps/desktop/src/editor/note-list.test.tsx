import { asNoteId, type NoteMeta } from "@spherewiki/shared"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteList } from "./note-list"

afterEach(cleanup)

const note = (id: string, title: string, path?: string, name?: string): NoteMeta => ({
  id: asNoteId(id),
  title,
  ...(path !== undefined ? { path } : {}),
  ...(name !== undefined ? { name } : {}),
})

describe("NoteList — folder tree (v1b)", () => {
  it("keeps pathless notes flat and never renders a folder group", () => {
    render(
      <NoteList
        notes={[note("a", "Home"), note("b", "Ideas")]}
        activeId={asNoteId("a")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    // Both notes are reachable, and there is no folder group (backward-compatible flat list).
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ideas" })).toBeTruthy()
    expect(screen.queryByLabelText(/^Folder /)).toBeNull()
  })

  it("groups notes by path into (nested) collapsible folders; folders render BELOW the level's notes", () => {
    render(
      <NoteList
        notes={[
          note("h", "Home"), // root
          note("m", "Meeting", "work"),
          note("d", "Deep", "work/projects"),
        ]}
        activeId={asNoteId("h")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    // "work" and the nested "projects" both render as folder groups.
    const work = screen.getByText("📁 work")
    const projects = screen.getByText("📁 projects")
    expect(work).toBeTruthy()
    expect(projects).toBeTruthy()

    // The subfolder note lives inside the "work" folder's <details>; the root note does not.
    const workDetails = work.closest("details") as HTMLElement
    expect(within(workDetails).getByRole("button", { name: "Meeting" })).toBeTruthy()
    expect(within(workDetails).getByRole("button", { name: "Deep" })).toBeTruthy() // nested under work/
    expect(within(workDetails).queryByRole("button", { name: "Home" })).toBeNull()

    // Notes-first: the root "Home" note is positioned ABOVE the "work" folder (folders group below
    // the level's plain notes). This is display-only — a note's real folder is its `path`.
    const nav = screen.getByRole("navigation")
    const homeButton = within(nav).getByRole("button", { name: "Home" })
    expect(homeButton.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("merges a note with its same-named child folder into one expandable node (folder-note)", () => {
    render(
      <NoteList
        notes={[
          note("p", "Project", undefined, "Project"), // Project.md at root
          note("c", "Task", "Project", "Task"), // Project/Task.md — a CHILD of Project
        ]}
        activeId={asNoteId("p")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    // "Project" is ONE node: a clickable note button that ALSO expands to show its child "Task".
    const projectBtn = screen.getByRole("button", { name: "Project" })
    const details = projectBtn.closest("details") as HTMLElement
    expect(details).toBeTruthy() // it's expandable (has a child)
    expect(within(details).getByRole("button", { name: "Task" })).toBeTruthy() // Task nested under it
  })

  it("offers a top 'New folder' button (only with folder support) that fires onCreateFolder", () => {
    const onCreateFolder = vi.fn()
    const { rerender } = render(
      <NoteList
        notes={[note("a", "Home")]}
        activeId={asNoteId("a")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.queryByRole("button", { name: "New folder" })).toBeNull() // no folders -> no subnote

    rerender(
      <NoteList
        notes={[note("a", "Home")]}
        activeId={asNoteId("a")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateFolder={onCreateFolder}
      />,
    )
    // Both creation buttons live at the top; no per-note ＋ clutters the tree.
    expect(screen.queryByLabelText(/^New note in /)).toBeNull()
    screen.getByRole("button", { name: "New folder" }).click()
    expect(onCreateFolder).toHaveBeenCalled()
  })

  it("renames via an inline input (Enter commits the typed title) — works without window.prompt", () => {
    const onRename = vi.fn()
    render(
      <NoteList
        notes={[note("m", "Meeting", "work")]}
        activeId={asNoteId("m")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    )
    // The ✎ opens an in-app text input (no browser prompt, which Tauri's WKWebView can't show).
    fireEvent.click(screen.getByLabelText("Rename Meeting"))
    const input = screen.getByLabelText("Rename Meeting") // now the input carries the label
    expect((input as HTMLInputElement).value).toBe("Meeting") // seeded with the current title
    fireEvent.change(input, { target: { value: "Standup" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onRename).toHaveBeenCalledWith(asNoteId("m"), "Standup")
  })

  it("cancels an inline rename on Escape without calling onRename", () => {
    const onRename = vi.fn()
    render(
      <NoteList
        notes={[note("m", "Meeting")]}
        activeId={asNoteId("m")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onRename={onRename}
      />,
    )
    fireEvent.click(screen.getByLabelText("Rename Meeting"))
    fireEvent.keyDown(screen.getByLabelText("Rename Meeting"), { key: "Escape" })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Meeting" })).toBeTruthy() // back to the note button
  })

  it("moves via an inline input (Enter commits the folder), only when onMove is provided", () => {
    const onMove = vi.fn()
    const { rerender } = render(
      <NoteList
        notes={[note("a", "Home")]}
        activeId={asNoteId("a")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText("Move Home")).toBeNull() // no folder support -> no move button

    rerender(
      <NoteList
        notes={[note("a", "Home", "old")]}
        activeId={asNoteId("a")}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onMove={onMove}
      />,
    )
    fireEvent.click(screen.getByLabelText("Move Home"))
    const input = screen.getByLabelText("Move Home")
    expect((input as HTMLInputElement).value).toBe("old") // seeded with the current folder
    fireEvent.change(input, { target: { value: "archive/2026" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onMove).toHaveBeenCalledWith(asNoteId("a"), "archive/2026")
  })
})
