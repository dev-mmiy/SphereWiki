import { describe, expect, it } from "vitest"
import { asNoteId } from "../types"
import { buildLinkGraph } from "../wikilink"
import { createMemoryVault } from "./memory"

describe("memory vault", () => {
  it("creates, lists, reads, and writes notes", () => {
    const vault = createMemoryVault()
    const a = vault.create("Alpha", "# Alpha\n[[Beta]]")
    vault.create("Beta", "# Beta")

    expect(vault.list().map((m) => m.title)).toEqual(["Alpha", "Beta"])
    expect(vault.read(a.id)).toContain("[[Beta]]")

    vault.write(a.id, "edited")
    expect(vault.read(a.id)).toBe("edited")
  })

  it("supports cross-note backlinks via the link graph", () => {
    const vault = createMemoryVault([
      { title: "Alpha", body: "see [[Beta]]" },
      { title: "Beta", body: "see [[Alpha]] and [[Beta]]" },
    ])
    const [alpha, beta] = vault.list()
    const graph = buildLinkGraph(vault.list().map((m) => ({ id: m.id, body: vault.read(m.id) })))

    expect(graph.backlinks.get("Beta")).toEqual(new Set([alpha?.id, beta?.id]))
    expect(graph.backlinks.get("Alpha")).toEqual(new Set([beta?.id]))
  })

  it("throws on an unknown note", () => {
    const vault = createMemoryVault()
    expect(() => vault.read(asNoteId("nope"))).toThrow(/unknown note/)
  })
})
