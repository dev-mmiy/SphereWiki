import { describe, expect, it } from "vitest"
import { buildGraphModel } from "./graph"
import type { LinkGraph } from "./types"
import { buildLinkGraph } from "./wikilink"

type Note = { id: string; title: string; body: string }
const note = (id: string, title: string, body: string): Note => ({ id, title, body })

function model(
  notes: Note[],
  options?: { includeDangling?: boolean },
): ReturnType<typeof buildGraphModel> {
  const graph = buildLinkGraph(notes.map((n) => ({ id: n.id, body: n.body })))
  return buildGraphModel(
    notes.map((n) => ({ id: n.id, title: n.title })),
    graph,
    options,
  )
}

describe("buildGraphModel", () => {
  it("makes one node per note, including isolated ones", () => {
    const m = model([note("a", "Home", ""), note("b", "Ideas", "")])
    expect(m.nodes).toEqual([
      { id: "a", title: "Home" },
      { id: "b", title: "Ideas" },
    ])
    expect(m.edges).toEqual([])
  })

  it("resolves a wikilink target title to the linked note's id", () => {
    const m = model([note("a", "Home", "see [[Ideas]]"), note("b", "Ideas", "back to [[Home]]")])
    expect(m.edges).toContainEqual({ from: "a", to: "b" })
    expect(m.edges).toContainEqual({ from: "b", to: "a" })
    expect(m.edges).toHaveLength(2)
  })

  it("drops dangling links whose title matches no note", () => {
    const m = model([note("a", "Home", "off to [[Nowhere]]")])
    expect(m.edges).toEqual([])
  })

  it("drops self-links", () => {
    const m = model([note("a", "Home", "I am [[Home]]")])
    expect(m.edges).toEqual([])
  })

  it("collapses duplicate links into a single edge", () => {
    const m = model([note("a", "Home", "[[Ideas]] and again [[Ideas]]"), note("b", "Ideas", "")])
    expect(m.edges).toEqual([{ from: "a", to: "b" }])
  })

  describe("includeDangling", () => {
    it("surfaces a dangling target as a ghost node with an edge to it", () => {
      const m = model([note("a", "Home", "off to [[Nowhere]]")], { includeDangling: true })
      expect(m.nodes).toContainEqual({ id: "dangling:Nowhere", title: "Nowhere", kind: "dangling" })
      expect(m.edges).toEqual([{ from: "a", to: "dangling:Nowhere" }])
    })

    it("collapses many notes' links to one missing title into a single ghost node", () => {
      const m = model([note("a", "A", "[[Missing]]"), note("b", "B", "see [[Missing]] too")], {
        includeDangling: true,
      })
      const ghosts = m.nodes.filter((n) => n.kind === "dangling")
      expect(ghosts).toEqual([{ id: "dangling:Missing", title: "Missing", kind: "dangling" }])
      expect(m.edges).toEqual([
        { from: "a", to: "dangling:Missing" },
        { from: "b", to: "dangling:Missing" },
      ])
    })

    it("still drops self-links and leaves real notes as plain {id,title} nodes", () => {
      const m = model([note("a", "Home", "I am [[Home]] linking [[Ideas]]")], {
        includeDangling: true,
      })
      // Home -> Home is a self-link (dropped); Ideas is dangling (ghost).
      expect(m.nodes).toContainEqual({ id: "a", title: "Home" }) // no kind on a real note
      expect(m.edges).toEqual([{ from: "a", to: "dangling:Ideas" }])
    })

    it("is opt-out by default — dangling links are dropped with no ghost", () => {
      const m = model([note("a", "Home", "off to [[Nowhere]]")])
      expect(m.nodes.some((n) => n.kind === "dangling")).toBe(false)
      expect(m.edges).toEqual([])
    })

    it("canonicalizes the title so whitespace variants share one ghost", () => {
      // A directly-built graph can carry non-trimmed targets (the Markdown pipeline trims them).
      const graph: LinkGraph = {
        outgoing: new Map([["a", new Set(["Foo", "Foo "])]]),
        backlinks: new Map(),
      }
      const m = buildGraphModel([{ id: "a", title: "A" }], graph, { includeDangling: true })
      expect(m.nodes.filter((n) => n.kind === "dangling")).toEqual([
        { id: "dangling:Foo", title: "Foo", kind: "dangling" },
      ])
      expect(m.edges).toEqual([{ from: "a", to: "dangling:Foo" }])
    })

    it("never emits a ghost id that collides with a real note's id", () => {
      // Pathological: a real note's id is literally the synthetic ghost id for another's link.
      const m = model([note("dangling:Ghost", "Weird", ""), note("n1", "Home", "see [[Ghost]]")], {
        includeDangling: true,
      })
      // Node ids stay unique (no second node with id "dangling:Ghost"); no ghost is emitted.
      expect(m.nodes.map((n) => n.id)).toEqual(["dangling:Ghost", "n1"])
      expect(m.nodes.some((n) => n.kind === "dangling")).toBe(false)
      expect(m.edges).toEqual([])
    })
  })
})
