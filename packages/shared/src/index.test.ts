import { describe, expect, it } from "vitest"
import { isWikiLink } from "./index"

describe("isWikiLink", () => {
  it("accepts a bare wikilink", () => {
    expect(isWikiLink("[[Home]]")).toBe(true)
  })

  it("rejects plain text", () => {
    expect(isWikiLink("Home")).toBe(false)
  })

  it("rejects a malformed link", () => {
    expect(isWikiLink("[[Home]")).toBe(false)
  })
})
