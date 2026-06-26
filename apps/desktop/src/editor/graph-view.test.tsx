import type { GraphEdge, GraphNode } from "@spherewiki/shared"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { GraphView } from "./graph-view"

const nodes: GraphNode[] = [
  { id: "a", title: "Home" },
  { id: "b", title: "Ideas" },
]
const edges: GraphEdge[] = [{ from: "a", to: "b" }]

describe("GraphView", () => {
  it("shows a hint when there are no notes", () => {
    render(<GraphView nodes={[]} edges={[]} activeId="a" onNavigate={() => {}} />)
    expect(screen.getByText(/no notes to graph/i)).toBeTruthy()
  })

  it("renders one button per note and navigates on click", () => {
    const onNavigate = vi.fn()
    render(<GraphView nodes={nodes} edges={edges} activeId="a" onNavigate={onNavigate} />)
    expect(screen.getByRole("button", { name: "Open Home" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open Ideas" }))
    expect(onNavigate).toHaveBeenCalledWith("b")
  })

  it("navigates on Enter", () => {
    const onNavigate = vi.fn()
    render(<GraphView nodes={nodes} edges={edges} activeId="a" onNavigate={onNavigate} />)
    fireEvent.keyDown(screen.getByRole("button", { name: "Open Home" }), { key: "Enter" })
    expect(onNavigate).toHaveBeenCalledWith("a")
  })

  it("marks the active node and only that one", () => {
    render(<GraphView nodes={nodes} edges={edges} activeId="b" onNavigate={() => {}} />)
    expect(screen.getByRole("button", { name: "Open Ideas" }).getAttribute("aria-current")).toBe(
      "true",
    )
    expect(
      screen.getByRole("button", { name: "Open Home" }).getAttribute("aria-current"),
    ).toBeNull()
  })

  it("draws one line per edge", () => {
    const { container } = render(
      <GraphView nodes={nodes} edges={edges} activeId="a" onNavigate={() => {}} />,
    )
    expect(container.querySelectorAll("line.graph-edge")).toHaveLength(1)
  })
})
