import { describe, expect, it } from "vitest"
import { buildLinkGraph, extractWikiLinks, isWikiLink } from "./wikilink"

describe("extractWikiLinks", () => {
  it("extracts a bare link with offsets", () => {
    const links = extractWikiLinks("see [[Home]] now")
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ target: "Home", raw: "[[Home]]", start: 4, end: 12 })
  })

  it("parses anchor and alias", () => {
    const [a, b] = extractWikiLinks("[[Note#Heading]] and [[Target|Display]]")
    expect(a).toMatchObject({ target: "Note", anchor: "Heading" })
    expect(b).toMatchObject({ target: "Target", alias: "Display" })
  })

  it("returns nothing when there are no links", () => {
    expect(extractWikiLinks("plain text")).toEqual([])
  })
})

describe("isWikiLink", () => {
  it("accepts a bare token and rejects others", () => {
    expect(isWikiLink("[[Home]]")).toBe(true)
    expect(isWikiLink("Home")).toBe(false)
    expect(isWikiLink("[[Home]")).toBe(false)
  })
})

describe("buildLinkGraph", () => {
  it("builds outgoing and backlink indexes", () => {
    const g = buildLinkGraph([
      { id: "a", body: "links to [[b]] and [[c]]" },
      { id: "b", body: "links to [[c]]" },
    ])
    expect(g.outgoing.get("a")).toEqual(new Set(["b", "c"]))
    expect(g.backlinks.get("c")).toEqual(new Set(["a", "b"]))
    expect(g.backlinks.get("b")).toEqual(new Set(["a"]))
  })

  it("has no backlink entry for an unreferenced note", () => {
    const g = buildLinkGraph([{ id: "a", body: "no links here" }])
    expect(g.outgoing.get("a")).toEqual(new Set())
    expect(g.backlinks.size).toBe(0)
  })
})
