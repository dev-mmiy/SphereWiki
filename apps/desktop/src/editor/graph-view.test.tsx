import type { GraphEdge, GraphNode } from "@spherewiki/shared"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { GraphView } from "./graph-view"

const nodes: GraphNode[] = [
  { id: "a", title: "Home" },
  { id: "b", title: "Ideas" },
]
const edges: GraphEdge[] = [{ from: "a", to: "b" }]

function renderGraph(
  props: Partial<Parameters<typeof GraphView>[0]> & {
    nodes: readonly GraphNode[]
    edges: readonly GraphEdge[]
  },
) {
  const onNavigate = props.onNavigate ?? vi.fn()
  const onCreate = props.onCreate ?? vi.fn()
  const result = render(
    <GraphView
      nodes={props.nodes}
      edges={props.edges}
      activeId={props.activeId ?? "a"}
      canCreate={props.canCreate ?? true}
      onNavigate={onNavigate}
      onCreate={onCreate}
    />,
  )
  return { ...result, onNavigate, onCreate }
}

describe("GraphView", () => {
  it("shows a hint when there are no notes", () => {
    renderGraph({ nodes: [], edges: [] })
    expect(screen.getByText(/no notes to graph/i)).toBeTruthy()
  })

  it("renders one button per note and navigates on click", () => {
    const { onNavigate } = renderGraph({ nodes, edges })
    expect(screen.getByRole("button", { name: "Open Home" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Open Ideas" }))
    expect(onNavigate).toHaveBeenCalledWith("b")
  })

  it("navigates on Enter", () => {
    const { onNavigate } = renderGraph({ nodes, edges })
    fireEvent.keyDown(screen.getByRole("button", { name: "Open Home" }), { key: "Enter" })
    expect(onNavigate).toHaveBeenCalledWith("a")
  })

  it("marks the active node and only that one", () => {
    renderGraph({ nodes, edges, activeId: "b" })
    expect(screen.getByRole("button", { name: "Open Ideas" }).getAttribute("aria-current")).toBe(
      "true",
    )
    expect(
      screen.getByRole("button", { name: "Open Home" }).getAttribute("aria-current"),
    ).toBeNull()
  })

  it("draws one line per edge", () => {
    const { container } = renderGraph({ nodes, edges })
    expect(container.querySelectorAll("line.graph-edge")).toHaveLength(1)
  })

  it("creates the note when a dangling ghost node is clicked", () => {
    const ghostNodes: GraphNode[] = [{ id: "a", title: "Home" }, ...ghost("Nowhere")]
    const { onCreate, onNavigate } = renderGraph({
      nodes: ghostNodes,
      edges: [{ from: "a", to: "dangling:Nowhere" }],
    })
    fireEvent.click(screen.getByRole("button", { name: "Create note: Nowhere" }))
    expect(onCreate).toHaveBeenCalledWith("Nowhere")
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("does not create from a ghost node without write permission", () => {
    const { onCreate } = renderGraph({
      nodes: [{ id: "a", title: "Home" }, ...ghost("Nowhere")],
      edges: [{ from: "a", to: "dangling:Nowhere" }],
      canCreate: false,
    })
    // A disabled ghost is labelled as uncreated (not "Create note:") so it never promises an action.
    const ghostBtn = screen.getByRole("button", { name: "Uncreated note: Nowhere" })
    expect(ghostBtn.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(ghostBtn)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("never marks a ghost node as the active note, even if activeId matches its id", () => {
    renderGraph({
      nodes: [{ id: "a", title: "Home" }, ...ghost("Nowhere")],
      edges: [{ from: "a", to: "dangling:Nowhere" }],
      activeId: "dangling:Nowhere", // a stray ghost activeId must not leak aria-current
    })
    expect(
      screen.getByRole("button", { name: "Create note: Nowhere" }).getAttribute("aria-current"),
    ).toBeNull()
  })
})

function ghost(title: string): GraphNode[] {
  return [{ id: `dangling:${title}`, title, kind: "dangling" }]
}
