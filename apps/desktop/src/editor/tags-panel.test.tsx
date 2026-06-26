import { asNoteId, type NoteId, type NoteMeta } from "@spherewiki/shared"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TagsPanel } from "./tags-panel"

const meta = (id: string, title: string): NoteMeta => ({ id: asNoteId(id), title })

function renderPanel(
  tags: readonly string[],
  opts: {
    notesForTag?: (tag: string) => readonly NoteMeta[]
    onNavigate?: (id: NoteId) => void
    canEdit?: boolean
    activeId?: string
  } = {},
) {
  const onNavigate = opts.onNavigate ?? vi.fn()
  const onAddTag = vi.fn()
  const onRemoveTag = vi.fn()
  render(
    <TagsPanel
      tags={tags}
      activeId={asNoteId(opts.activeId ?? "x")}
      canEdit={opts.canEdit ?? true}
      notesForTag={opts.notesForTag ?? (() => [])}
      onNavigate={onNavigate}
      onAddTag={onAddTag}
      onRemoveTag={onRemoveTag}
    />,
  )
  return { region: screen.getByRole("region", { name: "Tags" }), onNavigate, onAddTag, onRemoveTag }
}

describe("TagsPanel", () => {
  it("shows a hint when the note has no tags", () => {
    renderPanel([])
    expect(screen.getByText(/no tags yet/i)).toBeTruthy()
  })

  it("lists the active note's tags", () => {
    const { region } = renderPanel(["planning", "ideas"])
    expect(within(region).getByRole("button", { name: "#planning" })).toBeTruthy()
    expect(within(region).getByRole("button", { name: "#ideas" })).toBeTruthy()
  })

  it("reveals co-tagged notes on click and navigates to one", () => {
    const tagged = [meta("a", "Home"), meta("b", "Ideas")]
    const { region, onNavigate } = renderPanel(["shared"], {
      notesForTag: (tag) => (tag === "shared" ? tagged : []),
      activeId: "a",
    })
    // Co-tagged notes are hidden until the tag is opened.
    expect(within(region).queryByRole("button", { name: "Ideas" })).toBeNull()
    fireEvent.click(within(region).getByRole("button", { name: "#shared" }))
    const list = within(region).getByRole("list", { name: "Notes tagged shared" })
    fireEvent.click(within(list).getByRole("button", { name: "Ideas" }))
    expect(onNavigate).toHaveBeenCalledWith(asNoteId("b"))
  })

  it("closes the co-tagged list when the open tag leaves the active note's tags", () => {
    const tagged = [meta("a", "Home")]
    const props = {
      activeId: asNoteId("a"),
      canEdit: true,
      notesForTag: () => tagged,
      onNavigate: () => {},
      onAddTag: () => {},
      onRemoveTag: () => {},
    }
    const { rerender } = render(<TagsPanel tags={["shared", "other"]} {...props} />)
    const region = screen.getByRole("region", { name: "Tags" })
    fireEvent.click(within(region).getByRole("button", { name: "#shared" }))
    expect(within(region).getByRole("list", { name: "Notes tagged shared" })).toBeTruthy()
    rerender(<TagsPanel tags={["other"]} {...props} />)
    expect(within(region).queryByRole("list", { name: "Notes tagged shared" })).toBeNull()
  })

  it("adds a tag via the form and clears the input", () => {
    const { onAddTag } = renderPanel(["alpha"])
    const input = screen.getByRole("textbox", { name: "Add tag" }) as HTMLInputElement
    fireEvent.change(input, { target: { value: "  beta " } })
    fireEvent.submit(input.closest("form") as HTMLFormElement)
    expect(onAddTag).toHaveBeenCalledWith("beta") // trimmed
    expect(input.value).toBe("")
  })

  it("does not add a blank tag", () => {
    const { onAddTag } = renderPanel([])
    const input = screen.getByRole("textbox", { name: "Add tag" })
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.submit(input.closest("form") as HTMLFormElement)
    expect(onAddTag).not.toHaveBeenCalled()
  })

  it("removes a tag with its × control", () => {
    const { onRemoveTag } = renderPanel(["alpha", "beta"])
    fireEvent.click(screen.getByRole("button", { name: "Remove tag alpha" }))
    expect(onRemoveTag).toHaveBeenCalledWith("alpha")
  })

  it("hides editing affordances without write permission", () => {
    renderPanel(["alpha"], { canEdit: false })
    expect(screen.queryByRole("textbox", { name: "Add tag" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Remove tag alpha" })).toBeNull()
    // The tag itself is still shown (read-only) and navigable.
    expect(screen.getByRole("button", { name: "#alpha" })).toBeTruthy()
  })
})
