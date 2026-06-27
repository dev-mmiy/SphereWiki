import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SuggestionsReview } from "./suggestions-review"

const SUGGESTED = { links: ["Ideas", "Roadmap"], tags: ["planning"] }

function setup(suggested = SUGGESTED, busy = false) {
  const onApply = vi.fn()
  const onDismiss = vi.fn()
  render(
    <SuggestionsReview suggested={suggested} busy={busy} onApply={onApply} onDismiss={onDismiss} />,
  )
  return { onApply, onDismiss }
}

describe("SuggestionsReview", () => {
  it("lists the suggested links and tags, all checked by default", () => {
    setup()
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
    expect(boxes).toHaveLength(3)
    expect(boxes.every((b) => b.checked)).toBe(true)
    expect(screen.getByRole("button", { name: "Apply 3" })).toBeTruthy()
  })

  it("applies exactly the checked subset", () => {
    const { onApply } = setup()
    // Uncheck the "Roadmap" link.
    fireEvent.click(screen.getByRole("checkbox", { name: /Roadmap/ }))
    expect(screen.getByRole("button", { name: "Apply 2" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /^Apply/ }))
    expect(onApply).toHaveBeenCalledWith({ links: ["Ideas"], tags: ["planning"] })
  })

  it("disables Apply when nothing is selected", () => {
    setup()
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box)
    expect((screen.getByRole("button", { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it("dismisses without applying", () => {
    const { onApply, onDismiss } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it("disables the controls while an apply is in flight", () => {
    setup(SUGGESTED, true)
    expect((screen.getByRole("button", { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it("shows an empty state when there are no candidates", () => {
    setup({ links: [], tags: [] })
    expect(screen.getByText("No suggestions for this note.")).toBeTruthy()
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
  })
})
