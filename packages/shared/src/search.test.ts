import { describe, expect, it } from "vitest"
import { buildSearchIndex, searchNotes } from "./search"

type Note = { id: string; title: string; body: string }

function results(notes: Note[], query: string): string[] {
  const index = buildSearchIndex(notes)
  return searchNotes(index, query).map((h) => h.id)
}

const notes: Note[] = [
  { id: "a", title: "Planning", body: "# Planning\n\nRoadmap and milestones for the team.\n" },
  { id: "b", title: "Ideas", body: "---\ntags:\n  - planning\n---\n# Ideas\n\nbrainstorm notes\n" },
  { id: "c", title: "Cooking", body: "# Cooking\n\nrecipes and milestones unrelated\n" },
]

describe("searchNotes", () => {
  it("returns notes whose title or body matches a term", () => {
    expect(results(notes, "roadmap")).toEqual(["a"])
  })

  it("matches by title and ranks title hits above body-only hits", () => {
    // "planning": title of a; a tag of b; not in c. Title hit (a) outranks tag hit (b).
    expect(results(notes, "planning")).toEqual(["a", "b"])
  })

  it("matches a term found via frontmatter tags but not the raw YAML keys", () => {
    // b is tagged 'planning' (not in its visible body); searching the YAML key 'tags' finds nothing.
    expect(results(notes, "planning")).toContain("b")
    expect(results(notes, "tags")).toEqual([])
  })

  it("requires every query term to match (AND semantics)", () => {
    // 'milestones' is in a and c; 'roadmap' only in a → only a matches both.
    expect(results(notes, "milestones roadmap")).toEqual(["a"])
  })

  it("matches by prefix so partial words find notes", () => {
    expect(results(notes, "brainstor")).toEqual(["b"])
  })

  it("is case-insensitive", () => {
    expect(results(notes, "COOKING")).toEqual(["c"])
  })

  it("returns nothing for a blank query", () => {
    expect(results(notes, "   ")).toEqual([])
  })

  it("returns nothing when no note matches", () => {
    expect(results(notes, "nonexistentterm")).toEqual([])
  })
})
