import { describe, expect, it } from "vitest"
import type { CrdtSnapshot, EditOrigin } from "../crdt/types"
import { aiKeptRate, countAiVersionsAfter } from "./ai-metrics"
import type { Version } from "./types"

const human: EditOrigin = { actor: "alice", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }
const snap = new Uint8Array() as CrdtSnapshot

function version(id: string, origin: EditOrigin): Version {
  return { id, origin, snapshot: snap, createdAt: 0 }
}

describe("countAiVersionsAfter", () => {
  const versions = [
    version("v1", human),
    version("v2", ai),
    version("v3", human),
    version("v4", ai),
  ]

  it("counts AI versions after the revert target", () => {
    expect(countAiVersionsAfter(versions, "v1")).toBe(2) // v2, v4
    expect(countAiVersionsAfter(versions, "v2")).toBe(1) // v4
    expect(countAiVersionsAfter(versions, "v3")).toBe(1) // v4
    expect(countAiVersionsAfter(versions, "v4")).toBe(0) // nothing after
  })

  it("returns 0 when the target is unknown", () => {
    expect(countAiVersionsAfter(versions, "nope")).toBe(0)
  })

  it("returns 0 for empty history", () => {
    expect(countAiVersionsAfter([], "v1")).toBe(0)
  })
})

describe("aiKeptRate", () => {
  it("is null when nothing has been applied", () => {
    expect(aiKeptRate(0, 0)).toBeNull()
  })

  it("is the kept fraction of applied edits", () => {
    expect(aiKeptRate(10, 0)).toBe(1)
    expect(aiKeptRate(10, 3)).toBeCloseTo(0.7)
    expect(aiKeptRate(4, 1)).toBe(0.75)
  })

  it("clamps at 0 when reverts over-count applies", () => {
    expect(aiKeptRate(2, 5)).toBe(0)
  })
})
