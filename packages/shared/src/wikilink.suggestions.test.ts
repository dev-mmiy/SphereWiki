import { describe, expect, it } from "vitest"
import { wikilinkSuggestions } from "./wikilink"

const TITLES = ["Home", "Roadmap", "Road trip", "Ideas", "Backroad"]

describe("wikilinkSuggestions", () => {
  it("returns the leading titles (capped) for an empty query", () => {
    expect(wikilinkSuggestions(TITLES, "", 3)).toEqual(["Home", "Roadmap", "Road trip"])
  })

  it("is case-insensitive and ranks prefix matches before mid-string matches", () => {
    // "road": prefixes (Roadmap, Road trip) come before the mid-string match (Backroad).
    expect(wikilinkSuggestions(TITLES, "road")).toEqual(["Roadmap", "Road trip", "Backroad"])
    expect(wikilinkSuggestions(TITLES, "ROAD")).toEqual(["Roadmap", "Road trip", "Backroad"])
  })

  it("preserves input order within each rank group", () => {
    expect(wikilinkSuggestions(["Beta", "Alpha", "Alibi"], "al")).toEqual(["Alpha", "Alibi"])
  })

  it("returns nothing when no title matches", () => {
    expect(wikilinkSuggestions(TITLES, "zzz")).toEqual([])
  })

  it("drops empty titles and de-duplicates", () => {
    expect(wikilinkSuggestions(["Home", "", "Home", "Hope"], "ho")).toEqual(["Home", "Hope"])
  })

  it("respects the limit", () => {
    expect(wikilinkSuggestions(TITLES, "", 2)).toEqual(["Home", "Roadmap"])
    expect(wikilinkSuggestions(TITLES, "road", 1)).toEqual(["Roadmap"])
  })

  it("treats whitespace-only input as empty", () => {
    expect(wikilinkSuggestions(TITLES, "   ", 2)).toEqual(["Home", "Roadmap"])
  })
})
