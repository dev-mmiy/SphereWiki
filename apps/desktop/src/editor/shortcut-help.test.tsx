import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ShortcutHelp } from "./shortcut-help"

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">outside</button>
      <ShortcutHelp open={open} onClose={vi.fn()} />
    </>
  )
}

describe("ShortcutHelp", () => {
  it("renders nothing when closed", () => {
    render(<ShortcutHelp open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("lists the keyboard shortcuts when open", () => {
    render(<ShortcutHelp open={true} onClose={vi.fn()} />)
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy()
    // A couple of the documented bindings are present.
    expect(screen.getByText("Jump to note")).toBeTruthy()
    expect(screen.getByText("Toggle sidebar")).toBeTruthy()
  })

  it("moves focus in on open and restores it on close (modal a11y)", () => {
    const { rerender } = render(<Harness open={false} />)
    const outside = screen.getByRole("button", { name: "outside" })
    outside.focus()
    expect(document.activeElement).toBe(outside)

    rerender(<Harness open={true} />)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }))

    rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(outside)
  })

  it("Escape closes", () => {
    const onClose = vi.fn()
    render(<ShortcutHelp open={true} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Keyboard shortcuts" }), { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("the Close button and the backdrop both close", () => {
    const onClose = vi.fn()
    render(<ShortcutHelp open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(screen.getByRole("button", { name: "Close shortcut help" }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
