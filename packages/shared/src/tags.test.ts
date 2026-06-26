import { describe, expect, it } from "vitest"
import { addNoteTag, buildTagIndex, noteTags, removeNoteTag } from "./tags"

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

describe("addNoteTag", () => {
  it("adds a tag to a note that has no frontmatter", () => {
    expect(noteTags(addNoteTag("# Home\nbody", "planning"))).toEqual(["planning"])
  })

  it("appends to existing tags, preserving order", () => {
    const src = "---\ntags:\n  - alpha\n---\n# Note\n"
    expect(noteTags(addNoteTag(src, "beta"))).toEqual(["alpha", "beta"])
  })

  it("preserves other frontmatter keys and the body", () => {
    const out = addNoteTag("---\ntitle: X\n---\n# Body\n", "t")
    const parsed = noteTags(out)
    expect(parsed).toEqual(["t"])
    expect(out).toContain("title: X")
    expect(out).toContain("# Body")
  })

  it("is a no-op for a duplicate or blank tag", () => {
    const src = "---\ntags:\n  - alpha\n---\nbody"
    expect(addNoteTag(src, "alpha")).toBe(src)
    expect(addNoteTag(src, "   ")).toBe(src)
  })

  it("trims the added tag", () => {
    expect(noteTags(addNoteTag("# H", "  spaced  "))).toEqual(["spaced"])
  })
})

describe("removeNoteTag", () => {
  it("removes a tag, keeping the others", () => {
    const src = "---\ntags:\n  - alpha\n  - beta\n---\nbody"
    expect(noteTags(removeNoteTag(src, "alpha"))).toEqual(["beta"])
  })

  it("drops the frontmatter entirely when removing the last tag", () => {
    const out = removeNoteTag("---\ntags:\n  - only\n---\n# Body\n", "only")
    expect(out).toBe("# Body\n") // no empty `tags: []` left behind
  })

  it("keeps other frontmatter keys when removing the last tag", () => {
    const out = removeNoteTag("---\ntitle: X\ntags:\n  - only\n---\nbody", "only")
    expect(noteTags(out)).toEqual([])
    expect(out).toContain("title: X")
  })

  it("is a no-op when the tag is absent", () => {
    const src = "---\ntags:\n  - alpha\n---\nbody"
    expect(removeNoteTag(src, "missing")).toBe(src)
  })
})

describe("tag edits preserve unrelated frontmatter", () => {
  it("does not reserialize sibling scalar values (no float/string canonicalization)", () => {
    const src = "---\ntitle: Home\nversion: 1.0\nid: 7f3a-001\ntags:\n  - a\n---\nbody"
    const out = removeNoteTag(src, "a")
    expect(out).toContain("version: 1.0") // a full re-serialize would have made this `1`
    expect(out).toContain("id: 7f3a-001") // string id preserved verbatim (real ids are UUIDs)
    expect(out).toContain("title: Home")
    expect(noteTags(out)).toEqual([])
  })

  it("keeps an unrelated scalar intact when adding a tag", () => {
    const out = addNoteTag("---\nversion: 1.50\ntags:\n  - a\n---\nbody", "b")
    expect(out).toContain("version: 1.50")
    expect(noteTags(out)).toEqual(["a", "b"])
  })

  it("preserves YAML comments through an edit", () => {
    const out = addNoteTag("---\ntitle: X # the title\ntags:\n  - a\n---\nbody", "b")
    expect(out).toContain("# the title")
    expect(noteTags(out)).toEqual(["a", "b"])
  })

  it("keeps a non-string tag entry when editing a different tag", () => {
    const out = removeNoteTag("---\ntags:\n  - keep\n  - 99\n  - drop\n---\nbody", "drop")
    expect(out).toContain("99") // the numeric entry survives the edit
    expect(noteTags(out)).toEqual(["keep"]) // the index view still normalizes it away
  })

  it("does not destroy a non-list `tags:` value — preserves it as a tag", () => {
    const out = addNoteTag("---\ntags: notalist\n---\nbody", "x")
    expect(out).toContain("notalist")
    expect(noteTags(out)).toEqual(["notalist", "x"])
  })

  it("leaves malformed YAML frontmatter untouched rather than corrupting it", () => {
    const src = "---\n: : bad\n---\nbody"
    expect(addNoteTag(src, "x")).toBe(src)
  })
})
