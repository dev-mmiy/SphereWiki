import { asNoteId } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { createHeuristicSuggester } from "./heuristic"
import type { NoteContext } from "./types"

const suggester = createHeuristicSuggester()

function note(id: string, title: string, body: string): NoteContext {
  return { id: asNoteId(id), title, body }
}

describe("createHeuristicSuggester", () => {
  it("suggests a link for a sibling title mentioned verbatim", async () => {
    const s = await suggester.suggest({
      note: note("n1", "Home", "# Home\n\nSee Getting Started for more.\n"),
      siblings: [note("n2", "Getting Started", "")],
    })
    expect(s.links.map((l) => l.title)).toContain("Getting Started")
    expect(s.links[0]?.targetId).toBe(asNoteId("n2"))
  })

  it("does not suggest a link already inside [[...]]", async () => {
    const s = await suggester.suggest({
      note: note("n1", "Home", "See [[Ideas]] now.\n"),
      siblings: [note("n2", "Ideas", "")],
    })
    expect(s.links).toHaveLength(0)
  })

  it("never self-links", async () => {
    const s = await suggester.suggest({
      note: note("n1", "Home", "Home is where Home is.\n"),
      siblings: [note("n1", "Home", "")],
    })
    expect(s.links).toHaveLength(0)
  })

  it("respects word boundaries", async () => {
    const s = await suggester.suggest({
      note: note("n1", "X", "Visit the Homepage please.\n"),
      siblings: [note("n2", "Home", "")],
    })
    expect(s.links).toHaveLength(0)
  })

  it("auto-tags by frequency, excluding stopwords / existing tags / title words", async () => {
    const s = await suggester.suggest({
      note: note("n1", "Topic", "---\ntags:\n  - beta\n---\nalpha alpha gamma the the beta\n"),
      siblings: [],
    })
    const tags = s.tags.map((t) => t.tag)
    expect(tags[0]).toBe("alpha") // highest frequency first
    expect(tags).toContain("gamma")
    expect(tags).not.toContain("beta") // already a frontmatter tag
    expect(tags).not.toContain("the") // stopword
  })
})
