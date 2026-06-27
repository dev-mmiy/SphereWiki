import { describe, expect, it } from "vitest"
import { type AiEditMetrics, createAiMetricsRecorder } from "./ai-metrics"

/** A minimal in-memory Storage stand-in. */
function memStorage(): Pick<Storage, "getItem" | "setItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
}

describe("createAiMetricsRecorder", () => {
  it("starts at zero and accumulates applies and reverts", () => {
    const r = createAiMetricsRecorder()
    expect(r.snapshot()).toEqual<AiEditMetrics>({ applied: 0, reverted: 0, links: 0, tags: 0 })
    r.recordApply({ links: 2, tags: 1 })
    r.recordApply({ links: 1, tags: 3 })
    r.recordRevert(1)
    expect(r.snapshot()).toEqual<AiEditMetrics>({ applied: 2, reverted: 1, links: 3, tags: 4 })
  })

  it("ignores a non-positive revert", () => {
    const r = createAiMetricsRecorder()
    r.recordApply({ links: 0, tags: 0 })
    r.recordRevert(0)
    r.recordRevert(-2)
    expect(r.snapshot().reverted).toBe(0)
  })

  it("persists across recorders sharing a storage key", () => {
    const storage = memStorage()
    const key = "spherewiki:aimetrics:w1"
    const a = createAiMetricsRecorder({ storage, key })
    a.recordApply({ links: 5, tags: 2 })
    a.recordRevert(1)
    // A fresh recorder (e.g. after reload) loads the accumulated totals.
    const b = createAiMetricsRecorder({ storage, key })
    expect(b.snapshot()).toEqual<AiEditMetrics>({ applied: 1, reverted: 1, links: 5, tags: 2 })
    b.recordApply({ links: 1, tags: 1 })
    expect(b.snapshot().applied).toBe(2)
  })

  it("resets to zero on a malformed stored blob rather than poisoning the counters", () => {
    const storage = memStorage()
    const key = "k"
    storage.setItem(key, "{ not valid json")
    expect(createAiMetricsRecorder({ storage, key }).snapshot()).toEqual<AiEditMetrics>({
      applied: 0,
      reverted: 0,
      links: 0,
      tags: 0,
    })
    storage.setItem(key, JSON.stringify({ applied: "x", reverted: -1, links: 3 }))
    expect(createAiMetricsRecorder({ storage, key }).snapshot()).toEqual<AiEditMetrics>({
      applied: 0,
      reverted: 0,
      links: 3,
      tags: 0,
    })
  })
})
