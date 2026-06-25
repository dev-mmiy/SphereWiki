import { asNoteId, type NoteId, type NoteMeta } from "@spherewiki/shared"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TagsPanel } from "./tags-panel"

const meta = (id: string, title: string): NoteMeta => ({ id: asNoteId(id), title })

describe("TagsPanel", () => {
  it("shows a hint when the note has no tags", () => {
    render(
      <TagsPanel tags={[]} activeId={asNoteId("a")} notesForTag={() => []} onNavigate={() => {}} />,
    )
    expect(screen.getByText(/no tags yet/i)).toBeTruthy()
  })

  it("lists the active note's tags", () => {
    const region = renderPanel(["planning", "ideas"], () => [])
    expect(within(region).getByRole("button", { name: "#planning" })).toBeTruthy()
    expect(within(region).getByRole("button", { name: "#ideas" })).toBeTruthy()
  })

  it("reveals co-tagged notes on click and navigates to one", () => {
    const onNavigate = vi.fn()
    const tagged = [meta("a", "Home"), meta("b", "Ideas")]
    const region = renderPanel(
      ["shared"],
      (tag) => (tag === "shared" ? tagged : []),
      onNavigate,
      "a",
    )

    // Co-tagged notes are hidden until the tag is opened.
    expect(within(region).queryByRole("button", { name: "Ideas" })).toBeNull()
    fireEvent.click(within(region).getByRole("button", { name: "#shared" }))
    const list = within(region).getByRole("list", { name: "Notes tagged shared" })
    fireEvent.click(within(list).getByRole("button", { name: "Ideas" }))
    expect(onNavigate).toHaveBeenCalledWith(asNoteId("b"))
  })

  it("closes the co-tagged list when the open tag leaves the active note's tags", () => {
    const tagged = [meta("a", "Home")]
    const { rerender } = render(
      <TagsPanel
        tags={["shared", "other"]}
        activeId={asNoteId("a")}
        notesForTag={() => tagged}
        onNavigate={() => {}}
      />,
    )
    const region = screen.getByRole("region", { name: "Tags" })
    fireEvent.click(within(region).getByRole("button", { name: "#shared" }))
    expect(within(region).getByRole("list", { name: "Notes tagged shared" })).toBeTruthy()
    // The active note's frontmatter changed and no longer carries "shared" — the stale list closes.
    rerender(
      <TagsPanel
        tags={["other"]}
        activeId={asNoteId("a")}
        notesForTag={() => tagged}
        onNavigate={() => {}}
      />,
    )
    expect(within(region).queryByRole("list", { name: "Notes tagged shared" })).toBeNull()
  })

  it("toggles the co-tagged list closed on a second click", () => {
    const region = renderPanel(["shared"], () => [meta("a", "Home")])
    const tagBtn = within(region).getByRole("button", { name: "#shared" })
    fireEvent.click(tagBtn)
    expect(within(region).getByRole("list", { name: "Notes tagged shared" })).toBeTruthy()
    fireEvent.click(tagBtn)
    expect(within(region).queryByRole("list", { name: "Notes tagged shared" })).toBeNull()
  })
})

function renderPanel(
  tags: readonly string[],
  notesForTag: (tag: string) => readonly NoteMeta[],
  onNavigate: (id: NoteId) => void = () => {},
  activeId = "x",
): HTMLElement {
  render(
    <TagsPanel
      tags={tags}
      activeId={asNoteId(activeId)}
      notesForTag={notesForTag}
      onNavigate={onNavigate}
    />,
  )
  return screen.getByRole("region", { name: "Tags" })
}
