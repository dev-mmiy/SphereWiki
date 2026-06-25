import { describe, expect, it } from "vitest"
import { buildLinkGraph, extractWikiLinks, isWikiLink, renameWikiLinkTargets } from "./wikilink"

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

describe("renameWikiLinkTargets", () => {
  it("repoints a bare link and leaves surrounding text untouched", () => {
    expect(renameWikiLinkTargets("see [[Ideas]] now", "Ideas", "Concepts")).toBe(
      "see [[Concepts]] now",
    )
  })

  it("preserves an alias and an anchor when repointing", () => {
    expect(renameWikiLinkTargets("[[Ideas|my ideas]]", "Ideas", "Concepts")).toBe(
      "[[Concepts|my ideas]]",
    )
    expect(renameWikiLinkTargets("[[Ideas#Section]]", "Ideas", "Concepts")).toBe(
      "[[Concepts#Section]]",
    )
    expect(renameWikiLinkTargets("[[Ideas#Section|alias]]", "Ideas", "Concepts")).toBe(
      "[[Concepts#Section|alias]]",
    )
  })

  it("repoints every occurrence", () => {
    expect(renameWikiLinkTargets("[[Ideas]] and again [[Ideas]]", "Ideas", "X")).toBe(
      "[[X]] and again [[X]]",
    )
  })

  it("only repoints exact (trimmed, case-sensitive) target matches", () => {
    const body = "[[Ideas]] [[ideas]] [[Idea]] [[Ideas Backlog]]"
    expect(renameWikiLinkTargets(body, "Ideas", "X")).toBe(
      "[[X]] [[ideas]] [[Idea]] [[Ideas Backlog]]",
    )
  })

  it("matches a whitespace-padded target (the parser trims it)", () => {
    expect(renameWikiLinkTargets("[[ Ideas ]]", "Ideas", "Concepts")).toBe("[[Concepts]]")
  })

  it("treats the title literally — regex-special characters are not patterns", () => {
    expect(
      renameWikiLinkTargets("ref [[C++ Notes]] and [[C..Notes]]", "C++ Notes", "C Notes"),
    ).toBe("ref [[C Notes]] and [[C..Notes]]")
  })

  it("is a no-op when the body has no matching link", () => {
    const body = "nothing [[Else]] here"
    expect(renameWikiLinkTargets(body, "Ideas", "Concepts")).toBe(body)
  })

  it("is a no-op for a blank or unchanged target", () => {
    const body = "[[Ideas]]"
    expect(renameWikiLinkTargets(body, "", "Concepts")).toBe(body)
    expect(renameWikiLinkTargets(body, "Ideas", "Ideas")).toBe(body)
    expect(renameWikiLinkTargets(body, "Ideas", "  Ideas  ")).toBe(body)
  })

  it("is idempotent — re-running with the new target changes nothing further", () => {
    const once = renameWikiLinkTargets("[[Ideas]] [[Ideas|a]]", "Ideas", "Concepts")
    expect(renameWikiLinkTargets(once, "Ideas", "Concepts")).toBe(once)
  })
})
