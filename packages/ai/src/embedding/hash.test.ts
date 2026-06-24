import { describe, expect, it } from "vitest"
import { contentHash } from "./hash"

describe("contentHash", () => {
  it("is deterministic for the same input", () => {
    expect(contentHash("hello world")).toBe(contentHash("hello world"))
  })

  it("differs for different inputs (incl. near-collisions)", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"))
    expect(contentHash("hello")).not.toBe(contentHash("hellp"))
    expect(contentHash("ab")).not.toBe(contentHash("ba"))
  })

  it("is a stable fixed-width hex string", () => {
    expect(contentHash("anything at all")).toMatch(/^[0-9a-f]{16}$/)
    expect(contentHash("")).toMatch(/^[0-9a-f]{16}$/)
  })
})
