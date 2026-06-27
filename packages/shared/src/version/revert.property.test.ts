import { describe, expect, it } from "vitest"
import type { EditOrigin } from "../crdt/types"
import { yjsEngine } from "../crdt/yjs"
import { createMemoryVersionStore } from "./memory"

/**
 * Property test for "revert always works": over many seeded trials a note is driven through a
 * churn-heavy random edit history, committing a version after each edit; reverting to *every*
 * committed version must reproduce that version's exact text. This stresses the compacted snapshot
 * path (`snapshot()` round-trips through a `gc:true` doc), so tombstones from insert/delete churn
 * can never corrupt a restore point. Deterministic — a failing trial is reproducible from its seed.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomEdit(text: string, rand: () => number): string {
  if (text.length === 0 || rand() < 0.55) {
    const pos = Math.floor(rand() * (text.length + 1))
    const ch = String.fromCharCode(97 + Math.floor(rand() * 6))
    return text.slice(0, pos) + ch + text.slice(pos)
  }
  const pos = Math.floor(rand() * text.length)
  const len = 1 + Math.floor(rand() * Math.min(4, text.length - pos))
  return text.slice(0, pos) + text.slice(pos + len)
}

const TRIALS = 40
const EDITS = 14
const human: EditOrigin = { actor: "alice", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }

describe("version revert round-trip (property)", () => {
  it("reverting to any committed version reproduces its exact text", () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = rng(trial + 1)
      let counter = 0
      const store = createMemoryVersionStore(yjsEngine, {
        newId: () => `v${(++counter).toString()}`,
      })
      const note = yjsEngine.open()

      const expected: Array<{ id: string; text: string }> = []
      let text = ""
      for (let e = 0; e < EDITS; e++) {
        text = randomEdit(text, rand)
        // Alternate attribution so AI and human restore points are both exercised.
        const origin = e % 2 === 0 ? human : ai
        note.setText(text, origin)
        const version = store.commit(note, { origin })
        expected.push({ id: version.id, text })
      }

      for (const { id, text: want } of expected) {
        const past = store.open(id)
        try {
          expect(past.getText(), `trial ${trial.toString()} revert to ${id}`).toBe(want)
        } finally {
          past.destroy()
        }
      }
      note.destroy()
    }
  })
})
