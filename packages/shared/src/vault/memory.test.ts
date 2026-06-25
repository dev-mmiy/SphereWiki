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

  it("renames a note's title in place, leaving the body untouched", () => {
    const vault = createMemoryVault([{ title: "Alpha", body: "# Alpha\n" }])
    const [alpha] = vault.list()
    if (alpha === undefined) throw new Error("expected note")
    vault.rename(alpha.id, "Beta")
    expect(vault.list().map((m) => m.title)).toEqual(["Beta"])
    expect(vault.read(alpha.id)).toBe("# Alpha\n") // body is not the title's concern
  })

  it("rename is a no-op for an unknown id (does not throw or insert)", () => {
    const vault = createMemoryVault([{ title: "Alpha", body: "a" }])
    expect(() => vault.rename(asNoteId("nope"), "X")).not.toThrow()
    expect(vault.list().map((m) => m.title)).toEqual(["Alpha"])
  })

  it("ensure inserts at an explicit id if absent, else returns the existing meta unchanged", () => {
    const vault = createMemoryVault([{ title: "Home", body: "# Home\n" }])
    const [home] = vault.list()
    if (home === undefined) throw new Error("expected note")
    vault.write(home.id, "# Home\n\nlocal edit\n")

    // Insert-if-absent: a registry-known id this replica lacks becomes a real note.
    const added = vault.ensure(asNoteId("remote-1"), "Remote", "# Remote\n")
    expect(added.id).toBe("remote-1")
    expect(vault.read(asNoteId("remote-1"))).toBe("# Remote\n")

    // Never overwrites an existing note's body.
    const returned = vault.ensure(home.id, "Other", "# clobber\n")
    expect(returned.title).toBe("Home")
    expect(vault.read(home.id)).toBe("# Home\n\nlocal edit\n")
  })
})
