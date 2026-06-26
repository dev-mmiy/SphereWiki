import { describe, expect, it } from "vitest"
import { parseNote, splitFrontmatter, stringifyNote, withNoteBody } from "./frontmatter"

describe("parseNote", () => {
  it("returns empty frontmatter when there is none", () => {
    const r = parseNote("# Title\n\nbody")
    expect(r.frontmatter).toEqual({})
    expect(r.body).toBe("# Title\n\nbody")
  })

  it("parses frontmatter and body", () => {
    const r = parseNote("---\ntitle: Home\ntags:\n  - a\n  - b\n---\n# Hi\n")
    expect(r.frontmatter).toEqual({ title: "Home", tags: ["a", "b"] })
    expect(r.body).toBe("# Hi\n")
  })

  it("preserves a --- divider that appears in the body", () => {
    const r = parseNote("---\na: 1\n---\nbefore\n---\nafter")
    expect(r.frontmatter).toEqual({ a: 1 })
    expect(r.body).toBe("before\n---\nafter")
  })

  it("treats an unterminated frontmatter block as body", () => {
    const r = parseNote("---\nnope")
    expect(r.frontmatter).toEqual({})
    expect(r.body).toBe("---\nnope")
  })
})

describe("stringifyNote / round-trip", () => {
  it("recovers frontmatter and body after stringify→parse", () => {
    const note = { frontmatter: { title: "x", tags: ["a", "b"] }, body: "# Hi\n\ntext" }
    expect(parseNote(stringifyNote(note))).toEqual(note)
  })

  it("emits just the body when there is no frontmatter", () => {
    expect(stringifyNote({ frontmatter: {}, body: "plain" })).toBe("plain")
  })
})

describe("splitFrontmatter", () => {
  it("returns the raw YAML text and body", () => {
    expect(splitFrontmatter("---\ntitle: X\n---\n# Body\n")).toEqual({
      yaml: "title: X",
      body: "# Body\n",
    })
  })

  it("returns yaml: null when there is no frontmatter", () => {
    expect(splitFrontmatter("# Body only")).toEqual({ yaml: null, body: "# Body only" })
  })
})

describe("withNoteBody", () => {
  it("edits the body while preserving frontmatter text byte-for-byte", () => {
    // `version: 1.0` and the comment would be mangled by a parse→stringify round-trip.
    const src = "---\nversion: 1.0\nid: 7f3a # note id\n---\nhello"
    const out = withNoteBody(src, (b) => b.toUpperCase())
    expect(out).toBe("---\nversion: 1.0\nid: 7f3a # note id\n---\nHELLO")
  })

  it("returns the body verbatim when there is no frontmatter", () => {
    expect(withNoteBody("plain", (b) => `${b}!`)).toBe("plain!")
  })

  it("is a no-op (byte-identical) when the transform leaves the body unchanged", () => {
    const src = "---\na: 1\n---\nbody"
    expect(withNoteBody(src, (b) => b)).toBe(src)
  })
})
