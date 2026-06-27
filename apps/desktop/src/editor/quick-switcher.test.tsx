import type { NoteMeta, SearchHit } from "@spherewiki/shared"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { QuickSwitcher } from "./quick-switcher"

const NOTES = [
  { id: "n1", title: "Home" },
  { id: "n2", title: "Ideas" },
  { id: "n3", title: "Roadmap" },
] as unknown as NoteMeta[]

// A stub ranked search: substring match on the title, in note order.
const search = (q: string): readonly SearchHit[] =>
  NOTES.filter((n) => n.title.toLowerCase().includes(q.toLowerCase())).map((n, i) => ({
    id: n.id,
    title: n.title,
    score: 1 - i * 0.1,
  }))

function setup(open = true) {
  const onNavigate = vi.fn()
  const onClose = vi.fn()
  render(
    <QuickSwitcher
      open={open}
      notes={NOTES}
      search={search}
      onNavigate={onNavigate}
      onClose={onClose}
    />,
  )
  return { onNavigate, onClose }
}

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">outside</button>
      <QuickSwitcher
        open={open}
        notes={NOTES}
        search={search}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    </>
  )
}

describe("QuickSwitcher", () => {
  it("renders nothing when closed", () => {
    setup(false)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("moves focus to the input on open and restores it on close (modal a11y)", () => {
    const { rerender } = render(<Harness open={false} />)
    const outside = screen.getByRole("button", { name: "outside" })
    outside.focus()
    expect(document.activeElement).toBe(outside)

    rerender(<Harness open={true} />)
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Jump to note" }))

    rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(outside) // focus returned to where it was
  })

  it("lists all notes on an empty query and focuses the input", () => {
    setup()
    const input = screen.getByRole("textbox", { name: "Jump to note" })
    expect(document.activeElement).toBe(input)
    const results = screen.getByRole("list", { name: "Quick switcher results" })
    expect(results.querySelectorAll("li").length).toBe(3)
  })

  it("filters by the ranked search as you type", () => {
    setup()
    fireEvent.change(screen.getByRole("textbox", { name: "Jump to note" }), {
      target: { value: "road" },
    })
    expect(screen.getByRole("button", { name: "Roadmap" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull()
  })

  it("shows 'No matches' when nothing matches", () => {
    setup()
    fireEvent.change(screen.getByRole("textbox", { name: "Jump to note" }), {
      target: { value: "zzz" },
    })
    expect(screen.getByText("No matches")).toBeTruthy()
  })

  it("ArrowDown then Enter navigates to the selected note and closes", () => {
    const { onNavigate, onClose } = setup()
    const input = screen.getByRole("textbox", { name: "Jump to note" })
    fireEvent.keyDown(input, { key: "ArrowDown" }) // 0 → 1 (Ideas)
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onNavigate).toHaveBeenCalledWith("n2")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Enter without moving picks the first result", () => {
    const { onNavigate } = setup()
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Jump to note" }), { key: "Enter" })
    expect(onNavigate).toHaveBeenCalledWith("n1")
  })

  it("clicking a result navigates and closes", () => {
    const { onNavigate, onClose } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Ideas" }))
    expect(onNavigate).toHaveBeenCalledWith("n2")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("Escape closes without navigating", () => {
    const { onNavigate, onClose } = setup()
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Jump to note" }), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("clicking the backdrop closes", () => {
    const { onClose } = setup()
    // The backdrop is a sibling button (the dialog sits above it), so dialog clicks never dismiss.
    fireEvent.click(screen.getByRole("button", { name: "Close quick switcher" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
