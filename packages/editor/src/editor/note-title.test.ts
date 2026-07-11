import { describe, expect, it } from "vitest"
import { freshNoteTitle } from "./note-title"

describe("freshNoteTitle", () => {
  it("starts at Note 1 for an empty vault", () => {
    expect(freshNoteTitle([])).toBe("Note 1")
  })

  it("skips every taken Note N — never collides (so create won't resolve to another note)", () => {
    expect(freshNoteTitle(["Note 1", "Note 2"])).toBe("Note 3")
    // A gap from deletes: count-based `Note ${n+1}` would collide with the surviving "Note 3";
    // freshNoteTitle fills the lowest free slot instead.
    expect(freshNoteTitle(["Note 1", "Note 3"])).toBe("Note 2")
  })

  it("ignores unrelated titles and is not fooled by near-matches", () => {
    expect(freshNoteTitle(["Home", "Ideas", "Note", "Note 10", "Notes 1"])).toBe("Note 1")
    expect(freshNoteTitle(["Note 1", "Note 2", "Note 10"])).toBe("Note 3") // fills the gap, not 11
  })
})
