import { asNoteId, parseNote } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { applyLinkSuggestions, applyTagSuggestions, buildAgentEdit } from "./apply"
import type { LinkSuggestion, TagSuggestion } from "./types"

function link(title: string, id = "x"): LinkSuggestion {
  return { kind: "link", title, targetId: asNoteId(id) }
}
function tag(t: string): TagSuggestion {
  return { kind: "tag", tag: t }
}

describe("applyLinkSuggestions", () => {
  it("links the first unlinked mention and is idempotent", () => {
    const body = "See Ideas and Ideas again.\n"
    const once = applyLinkSuggestions(body, [link("Ideas")])
    expect(once).toBe("See [[Ideas]] and Ideas again.\n")
    expect(applyLinkSuggestions(once, [link("Ideas")])).toBe(once)
  })

  it("handles multiple distinct mentions without offset corruption", () => {
    const body = "Home links to Ideas.\n"
    const out = applyLinkSuggestions(body, [link("Home"), link("Ideas")])
    expect(out).toBe("[[Home]] links to [[Ideas]].\n")
  })

  it("is a no-op when nothing matches", () => {
    const body = "nothing here\n"
    expect(applyLinkSuggestions(body, [link("Absent")])).toBe(body)
  })

  it("prefers the longer link when two titles overlap", () => {
    const out = applyLinkSuggestions("Read Getting Started Guide today.\n", [
      link("Getting Started"),
      link("Getting Started Guide"),
    ])
    expect(out).toBe("Read [[Getting Started Guide]] today.\n")
  })
})

describe("applyTagSuggestions", () => {
  it("merges and de-dupes into frontmatter", () => {
    const src = "---\ntags:\n  - one\n---\n# Body\n"
    const out = applyTagSuggestions(src, [tag("one"), tag("two")])
    expect(parseNote(out).frontmatter.tags).toEqual(["one", "two"])
  })

  it("adds frontmatter to a note that had none, preserving the body", () => {
    const out = applyTagSuggestions("# Body only\n", [tag("fresh")])
    expect(parseNote(out).frontmatter.tags).toEqual(["fresh"])
    expect(parseNote(out).body).toBe("# Body only\n")
  })

  it("is a no-op (byte-identical) when all tags already exist", () => {
    const src = "---\ntags:\n  - one\n---\n# Body\n"
    expect(applyTagSuggestions(src, [tag("one")])).toBe(src)
  })
})

describe("buildAgentEdit", () => {
  it("composes links (body) and tags (frontmatter) into one document", () => {
    const out = buildAgentEdit("See Ideas.\n", { links: [link("Ideas")], tags: [tag("topic")] })
    const parsed = parseNote(out)
    expect(parsed.body).toContain("[[Ideas]]")
    expect(parsed.frontmatter.tags).toEqual(["topic"])
  })

  it("is a no-op when nothing applies", () => {
    const src = "plain text\n"
    expect(buildAgentEdit(src, { links: [], tags: [] })).toBe(src)
  })

  it("is idempotent", () => {
    const src = "See Ideas.\n"
    const once = buildAgentEdit(src, { links: [link("Ideas")], tags: [tag("topic")] })
    expect(buildAgentEdit(once, { links: [link("Ideas")], tags: [tag("topic")] })).toBe(once)
  })
})
