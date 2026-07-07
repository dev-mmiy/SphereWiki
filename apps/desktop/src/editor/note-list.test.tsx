import { asNoteId, type NoteMeta } from "@spherewiki/shared"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteList } from "./note-list"

afterEach(cleanup)

const note = (id: string, title: string, path?: string): NoteMeta =>
  path === undefined ? { id: asNoteId(id), title } : { id: asNoteId(id), title, path }

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

  it("groups notes by their path into (nested) collapsible folders, root notes at top", () => {
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
    const work = screen.getByLabelText("Folder work")
    const projects = screen.getByLabelText("Folder projects")
    expect(work).toBeTruthy()
    expect(projects).toBeTruthy()

    // The subfolder note lives inside the "work" folder's <details>; the root note does not.
    const workDetails = work.closest("details") as HTMLElement
    expect(within(workDetails).getByRole("button", { name: "Meeting" })).toBeTruthy()
    expect(within(workDetails).getByRole("button", { name: "Deep" })).toBeTruthy() // nested under work/
    expect(within(workDetails).queryByRole("button", { name: "Home" })).toBeNull()
  })

  it("still wires per-note rename/delete inside a folder", () => {
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
    screen.getByLabelText("Rename Meeting").click()
    expect(onRename).toHaveBeenCalledWith(asNoteId("m"))
  })
})
