import { describe, expect, it } from "vitest"
import { buildGraphModel } from "./graph"
import { buildLinkGraph } from "./wikilink"

type Note = { id: string; title: string; body: string }
const note = (id: string, title: string, body: string): Note => ({ id, title, body })

function model(notes: Note[]): ReturnType<typeof buildGraphModel> {
  const graph = buildLinkGraph(notes.map((n) => ({ id: n.id, body: n.body })))
  return buildGraphModel(
    notes.map((n) => ({ id: n.id, title: n.title })),
    graph,
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
})
