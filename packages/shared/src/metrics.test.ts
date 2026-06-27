import { describe, expect, it } from "vitest"
import { buildGraphModel } from "./graph"
import { buildWorkspaceMetrics } from "./metrics"
import { buildTagIndex } from "./tags"
import { buildLinkGraph } from "./wikilink"

type Note = { id: string; title: string; body: string }

function metrics(notes: Note[]): ReturnType<typeof buildWorkspaceMetrics> {
  const linkGraph = buildLinkGraph(notes.map((n) => ({ id: n.id, body: n.body })))
  const graph = buildGraphModel(
    notes.map((n) => ({ id: n.id, title: n.title })),
    linkGraph,
    { includeDangling: true },
  )
  const tags = buildTagIndex(notes.map((n) => ({ id: n.id, body: n.body })))
  return buildWorkspaceMetrics(graph, tags)
}

describe("buildWorkspaceMetrics", () => {
  it("counts notes and resolved note→note links", () => {
    const m = metrics([
      { id: "a", title: "Home", body: "see [[Ideas]]" },
      { id: "b", title: "Ideas", body: "back to [[Home]]" },
    ])
    expect(m.notes).toBe(2)
    expect(m.links).toBe(2) // Home→Ideas, Ideas→Home
    expect(m.unwrittenLinks).toBe(0)
  })

  it("counts unwritten (dangling) links as the frontier, not as resolved links", () => {
    const m = metrics([{ id: "a", title: "Home", body: "to [[Nowhere]] and [[Elsewhere]]" }])
    expect(m.notes).toBe(1)
    expect(m.links).toBe(0)
    expect(m.unwrittenLinks).toBe(2)
  })

  it("counts distinct tags and tagged notes (deduped across notes)", () => {
    const m = metrics([
      { id: "a", title: "A", body: "---\ntags:\n  - x\n  - y\n---\nA" },
      { id: "b", title: "B", body: "---\ntags:\n  - y\n---\nB" },
      { id: "c", title: "C", body: "# C no tags" },
    ])
    expect(m.notes).toBe(3)
    expect(m.tags).toBe(2) // x, y (y shared)
    expect(m.taggedNotes).toBe(2) // a, b
  })

  it("is empty for an empty workspace", () => {
    expect(metrics([])).toEqual({
      notes: 0,
      links: 0,
      unwrittenLinks: 0,
      tags: 0,
      taggedNotes: 0,
    })
  })
})
