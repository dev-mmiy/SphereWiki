import { describe, expect, it } from "vitest"
import type { EditOrigin } from "../crdt/types"
import { aiGraphLedger, aiNoteLedger, type LedgerVersion, share } from "./contribution"

const human: EditOrigin = { actor: "you", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }

/** A note carrying frontmatter tags + a body. */
const note = (tags: string[], links: string[]): string => {
  const fm = tags.length === 0 ? "" : `---\ntags:\n${tags.map((t) => `  - ${t}`).join("\n")}\n---\n`
  return `${fm}Body here.\n${links.map((l) => `See [[${l}]].`).join(" ")}`
}

const lv = (id: string, origin: EditOrigin, text: string, parentText?: string): LedgerVersion => ({
  id,
  origin,
  text,
  parentText,
})

describe("aiNoteLedger", () => {
  it("is all-zeros and a 0 contribution for an empty note", () => {
    const led = aiNoteLedger([], note([], []))
    expect(led.aiEdits).toBe(0)
    expect(led.links).toEqual({ ever: 0, kept: 0, reverted: 0, current: 0 })
    expect(led.tags).toEqual({ ever: 0, kept: 0, reverted: 0, current: 0 })
  })

  it("ignores human-origin versions — only AI edits count toward AI", () => {
    // A human adds a link then a tag; no AI version exists.
    const versions: LedgerVersion[] = [
      lv("v1", human, note([], ["Alpha"]), note([], [])),
      lv("v2", human, note(["t1"], ["Alpha"]), note([], ["Alpha"])),
    ]
    const led = aiNoteLedger(versions, note(["t1"], ["Alpha"]))
    expect(led.aiEdits).toBe(0)
    expect(led.links.ever).toBe(0)
    expect(led.tags.ever).toBe(0)
    // The note DOES carry a current link/tag, but none trace to the AI.
    expect(led.links.current).toBe(1)
    expect(led.links.kept).toBe(0)
  })

  it("counts an AI-introduced link that the note keeps", () => {
    const versions: LedgerVersion[] = [
      // Base state, human.
      lv("v1", human, note([], [])),
      // AI introduces [[Alpha]]; parent is the human base.
      lv("v2", ai, note([], ["Alpha"]), note([], [])),
    ]
    const led = aiNoteLedger(versions, note([], ["Alpha"]))
    expect(led.aiEdits).toBe(1)
    expect(led.links).toEqual({ ever: 1, kept: 1, reverted: 0, current: 1 })
    // 1 kept of 1 current link → the note is 100% AI-authored on links.
    expect(share(led.links.kept, led.links.current)).toBe(1)
  })

  it("classifies an AI-introduced link as reverted once removed", () => {
    const versions: LedgerVersion[] = [
      lv("v1", human, note([], [])),
      lv("v2", ai, note([], ["Gone"]), note([], [])),
      // A later human edit removes [[Gone]].
      lv("v3", human, note([], []), note([], ["Gone"])),
    ]
    const led = aiNoteLedger(versions, note([], []))
    expect(led.links).toEqual({ ever: 1, kept: 0, reverted: 1, current: 0 })
    // No current links → a 0 contribution (not 0/0 NaN).
    expect(share(led.links.kept, led.links.current)).toBe(0)
  })

  it("counts each distinct AI-introduced value once, even when re-introduced", () => {
    // AI adds [[Beta]], it's reverted, then re-introduced by a second AI edit.
    const versions: LedgerVersion[] = [
      lv("v1", human, note([], [])),
      lv("v2", ai, note([], ["Beta"]), note([], [])),
      lv("v3", human, note([], []), note([], ["Beta"])),
      // Re-apply: the same value is introduced again by the AI.
      lv("v4", ai, note([], ["Beta"]), note([], [])),
    ]
    const led = aiNoteLedger(versions, note([], ["Beta"]))
    // Distinct values deduped: Beta appears once even though two AI edits made it.
    expect(led.links).toEqual({ ever: 1, kept: 1, reverted: 0, current: 1 })
    expect(led.aiEdits).toBe(2)
  })

  it("self-corrects a reverted link back to kept when re-applied", () => {
    // v2 introduces [[Beta]]; v3 (human) reverts it; current text re-applies it.
    const versions: LedgerVersion[] = [
      lv("v1", human, note([], [])),
      lv("v2", ai, note([], ["Beta"]), note([], [])),
      lv("v3", human, note([], []), note([], ["Beta"])),
    ]
    // With the value gone from the current text the ledger says reverted:
    expect(aiNoteLedger(versions, note([], [])).links.reverted).toBe(1)
    expect(aiNoteLedger(versions, note([], [])).links.kept).toBe(0)
    // With the value present again it self-corrects to kept:
    const kept = aiNoteLedger(versions, note([], ["Beta"]))
    expect(kept.links.kept).toBe(1)
    expect(kept.links.reverted).toBe(0)
  })

  it("attributes frontmatter tags introduced by the AI", () => {
    const versions: LedgerVersion[] = [
      lv("v1", human, note([], [])),
      lv("v2", ai, note(["alpha", "beta"], []), note([], [])),
    ]
    const led = aiNoteLedger(versions, note(["alpha", "beta"], []))
    expect(led.tags).toEqual({ ever: 2, kept: 2, reverted: 0, current: 2 })
    expect(share(led.tags.kept, led.tags.current)).toBe(1)
  })

  it("treats a missing parent as the empty base (the first version introduces all)", () => {
    // An AI version with no parent diffing against "" → every link/tag is introduced.
    const versions: LedgerVersion[] = [lv("v1", ai, note(["t"], ["Link1"]))]
    const led = aiNoteLedger(versions, note(["t"], ["Link1"]))
    expect(led.links).toEqual({ ever: 1, kept: 1, reverted: 0, current: 1 })
    expect(led.tags).toEqual({ ever: 1, kept: 1, reverted: 0, current: 1 })
  })

  it("blends AI vs human on the current note's contributions", () => {
    // AI introduces Alpha; a human adds Gamma; current note keeps both.
    const versions: LedgerVersion[] = [
      lv("v1", human, note([], [])),
      lv("v2", ai, note([], ["Alpha"]), note([], [])),
      lv("v3", human, note([], ["Alpha", "Gamma"]), note([], ["Alpha"])),
    ]
    const led = aiNoteLedger(versions, note([], ["Alpha", "Gamma"]))
    expect(led.links).toEqual({ ever: 1, kept: 1, reverted: 0, current: 2 })
    // 1 of 2 current links trace to the AI → a 50% contribution share.
    expect(share(led.links.kept, led.links.current)).toBe(0.5)
  })
})

describe("share", () => {
  it("is 0 for a 0/0 ratio (never NaN)", () => {
    expect(share(0, 0)).toBe(0)
  })
  it("clamps to the exact fraction otherwise", () => {
    expect(share(2, 4)).toBe(0.5)
    expect(share(3, 1)).toBe(3) // more kept than current (impossible via this fold, but defined)
  })
})

describe("aiGraphLedger", () => {
  it("sums a graph-wide weighted contribution, not an average of per-note ratios", () => {
    // Note A: 2 current links, 1 AI-kept. Note B: 2 current links, 1 AI-kept.
    const a = aiNoteLedger(
      [lv("a1", human, note([], [])), lv("a2", ai, note([], ["Alpha"]), note([], []))],
      note([], ["Alpha", "Human"]),
    )
    const b = aiNoteLedger(
      [lv("b1", human, note([], [])), lv("b2", ai, note([], ["Beta"]), note([], []))],
      note([], ["Beta", "Human2"]),
    )
    const graph = aiGraphLedger([
      { ledger: a, linksCurrent: a.links.current, tagsCurrent: a.tags.current },
      { ledger: b, linksCurrent: b.links.current, tagsCurrent: b.tags.current },
    ])
    expect(graph.aiEdits).toBe(2)
    expect(graph.links).toEqual({ ever: 2, kept: 2, reverted: 0, current: 4 })
    // 2 of 4 current links are AI-authored — a true 50% weighted share.
    expect(share(graph.links.kept, graph.links.current)).toBe(0.5)
  })

  it("weights tiny notes correctly against large ones", () => {
    // Note A: 1 current link, 1 AI-kept (100% per-note).
    // Note B: 100 current links, 0 AI-kept (0% per-note).
    // Average-of-ratios would say 50%; the weighted fold says 1/101.
    const manyLinks = Array.from({ length: 100 }, (_, i) => `H${i}`)
    const a = aiNoteLedger([lv("a", ai, note([], ["X"]), "")], note([], ["X"]))
    const b = aiNoteLedger([], note([], manyLinks))
    const graph = aiGraphLedger([
      { ledger: a, linksCurrent: a.links.current, tagsCurrent: 0 },
      { ledger: b, linksCurrent: b.links.current, tagsCurrent: 0 },
    ])
    expect(graph.links.current).toBe(101)
    expect(graph.links.kept).toBe(1)
    expect(share(graph.links.kept, graph.links.current)).toBeCloseTo(1 / 101, 10)
  })

  it("collapses to all-zeros for an empty graph", () => {
    expect(aiGraphLedger([])).toEqual({
      aiEdits: 0,
      links: { ever: 0, kept: 0, reverted: 0, current: 0 },
      tags: { ever: 0, kept: 0, reverted: 0, current: 0 },
    })
  })
})
