import { describe, expect, it } from "vitest"
import { buildTagIndex, noteTags } from "./tags"

describe("noteTags", () => {
  it("returns no tags for a note without frontmatter", () => {
    expect(noteTags("# Home\n\nplain body")).toEqual([])
  })

  it("reads tags from YAML frontmatter", () => {
    const src = "---\ntags:\n  - alpha\n  - beta\n---\n# Note\n"
    expect(noteTags(src)).toEqual(["alpha", "beta"])
  })

  it("normalizes: trims, drops empty/non-strings, de-duplicates, preserves order", () => {
    const src = "---\ntags:\n  - ' beta '\n  - alpha\n  - beta\n  - ''\n  - 7\n---\nbody\n"
    expect(noteTags(src)).toEqual(["beta", "alpha"])
  })

  it("returns no tags when `tags` is absent or not a list", () => {
    expect(noteTags("---\ntitle: X\n---\nbody")).toEqual([])
    expect(noteTags("---\ntags: notalist\n---\nbody")).toEqual([])
  })
})

describe("buildTagIndex", () => {
  it("indexes tag → note ids and note id → tags", () => {
    const index = buildTagIndex([
      { id: "a", body: "---\ntags:\n  - x\n  - y\n---\nA" },
      { id: "b", body: "---\ntags:\n  - y\n---\nB" },
      { id: "c", body: "# C\nno tags" },
    ])
    expect(index.byTag.get("x")).toEqual(new Set(["a"]))
    expect(index.byTag.get("y")).toEqual(new Set(["a", "b"]))
    expect(index.byNote.get("a")).toEqual(["x", "y"])
    expect(index.byNote.get("c")).toEqual([])
  })

  it("has no entry for a tag no note carries", () => {
    const index = buildTagIndex([{ id: "a", body: "# A" }])
    expect(index.byTag.size).toBe(0)
  })
})
