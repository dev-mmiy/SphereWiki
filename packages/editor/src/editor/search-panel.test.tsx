import type { SearchHit } from "@spherewiki/shared"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SearchPanel } from "./search-panel"

// A fake search: returns a hit for "plan", nothing otherwise.
const fakeSearch = (q: string): SearchHit[] =>
  q.toLowerCase().includes("plan") ? [{ id: "a", title: "Planning", score: 6 }] : []

describe("SearchPanel", () => {
  it("shows no results region until the user types", () => {
    render(<SearchPanel search={fakeSearch} onNavigate={() => {}} />)
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull()
  })

  it("lists ranked hits as the query is typed and navigates on click", () => {
    const onNavigate = vi.fn()
    render(<SearchPanel search={fakeSearch} onNavigate={onNavigate} />)
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "plan" },
    })
    const list = screen.getByRole("list", { name: "Search results" })
    fireEvent.click(within(list).getByRole("button", { name: "Planning" }))
    expect(onNavigate).toHaveBeenCalledWith("a")
  })

  it("shows an empty hint when a non-blank query matches nothing", () => {
    render(<SearchPanel search={fakeSearch} onNavigate={() => {}} />)
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "zzz" },
    })
    expect(screen.getByText(/no matches/i)).toBeTruthy()
  })

  it("hides results again when the query is cleared", () => {
    render(<SearchPanel search={fakeSearch} onNavigate={() => {}} />)
    const box = screen.getByRole("searchbox", { name: "Search notes" })
    fireEvent.change(box, { target: { value: "plan" } })
    expect(screen.getByRole("list", { name: "Search results" })).toBeTruthy()
    fireEvent.change(box, { target: { value: "" } })
    expect(screen.queryByRole("list", { name: "Search results" })).toBeNull()
  })
})
