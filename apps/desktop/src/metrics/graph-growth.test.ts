import { describe, expect, it } from "vitest"
import { createGraphBaselineRecorder } from "./graph-growth"

function memStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v)
    },
  }
}

describe("createGraphBaselineRecorder", () => {
  it("reports no growth until a baseline is captured", () => {
    const rec = createGraphBaselineRecorder()
    expect(rec.growth({ notes: 5, links: 3, tags: 2 })).toBeNull()
  })

  it("captures the baseline on first ensure and measures growth from it", () => {
    const rec = createGraphBaselineRecorder()
    rec.ensure({ notes: 5, links: 3, tags: 2 })
    expect(rec.growth({ notes: 8, links: 5, tags: 2 })).toEqual({ notes: 3, links: 2, tags: 0 })
  })

  it("freezes the baseline — later ensure calls are no-ops", () => {
    const rec = createGraphBaselineRecorder()
    rec.ensure({ notes: 5, links: 3, tags: 2 })
    rec.ensure({ notes: 9, links: 9, tags: 9 }) // ignored — baseline is the first snapshot
    expect(rec.growth({ notes: 6, links: 3, tags: 2 })).toEqual({ notes: 1, links: 0, tags: 0 })
  })

  it("reports negative growth when the graph shrinks (deletions)", () => {
    const rec = createGraphBaselineRecorder()
    rec.ensure({ notes: 5, links: 3, tags: 2 })
    expect(rec.growth({ notes: 4, links: 3, tags: 1 })).toEqual({ notes: -1, links: 0, tags: -1 })
  })

  it("persists the baseline across recorder instances (same storage + key)", () => {
    const storage = memStorage()
    const key = "spherewiki:graphbaseline:w1"
    const a = createGraphBaselineRecorder({ storage, key })
    a.ensure({ notes: 5, links: 3, tags: 2 })
    // A fresh recorder (e.g. after reload) loads the persisted baseline and won't overwrite it.
    const b = createGraphBaselineRecorder({ storage, key })
    b.ensure({ notes: 100, links: 100, tags: 100 })
    expect(b.growth({ notes: 7, links: 3, tags: 2 })).toEqual({ notes: 2, links: 0, tags: 0 })
  })

  it("ignores a malformed persisted blob (recaptures cleanly)", () => {
    const storage = memStorage()
    const key = "spherewiki:graphbaseline:w1"
    storage.map.set(key, "{not json")
    const rec = createGraphBaselineRecorder({ storage, key })
    expect(rec.growth({ notes: 5, links: 3, tags: 2 })).toBeNull()
    rec.ensure({ notes: 5, links: 3, tags: 2 })
    expect(rec.growth({ notes: 6, links: 3, tags: 2 })).toEqual({ notes: 1, links: 0, tags: 0 })
  })
})
