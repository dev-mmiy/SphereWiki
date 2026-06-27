import { describe, expect, it } from "vitest"
import type { EditOrigin } from "./types"
import { yjsEngine } from "./yjs"

/**
 * Property/fuzz tests for the data-safety invariant the MVP cannot compromise: **CRDT convergence
 * with no lost edits**. Over many seeded trials, several replicas each make independent random
 * edits and then mesh-merge; every replica must converge to identical text, and each replica's
 * unique sentinel must survive (no committed edit is dropped). Deterministic — a failing trial is
 * reproducible from its seed.
 */

/** mulberry32: a tiny seeded PRNG so trials are deterministic and reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Apply one random insert or delete to `text` (alphabet a–e, distinct from the X/Y/Z sentinels). */
function randomEdit(text: string, rand: () => number): string {
  if (text.length === 0 || rand() < 0.6) {
    const pos = Math.floor(rand() * (text.length + 1))
    const ch = String.fromCharCode(97 + Math.floor(rand() * 5))
    return text.slice(0, pos) + ch + text.slice(pos)
  }
  const pos = Math.floor(rand() * text.length)
  const len = 1 + Math.floor(rand() * Math.min(3, text.length - pos))
  return text.slice(0, pos) + text.slice(pos + len)
}

const TRIALS = 40
const EDITS_PER_REPLICA = 8
const SENTINELS = ["X", "Y", "Z"] as const

describe("CRDT convergence (property)", () => {
  it("converges identically across replicas with no lost edits", () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = rng(trial + 1)

      // A common starting point all replicas fork from.
      const base = yjsEngine.open()
      base.setText("seed", { actor: "base", kind: "human" })
      const start = base.encodeState()
      base.destroy()

      const replicas = SENTINELS.map(() => yjsEngine.open(start))
      replicas.forEach((replica, i) => {
        const origin: EditOrigin = { actor: `r${i.toString()}`, kind: "human" }
        let text = replica.getText()
        for (let e = 0; e < EDITS_PER_REPLICA; e++) {
          text = randomEdit(text, rand)
          replica.setText(text, origin)
        }
        // A unique single-char sentinel appended last — a concurrent peer can't have deleted it,
        // so it must survive the merge (single chars can't be interleaved away).
        replica.setText(`${replica.getText()}${SENTINELS[i]}`, origin)
      })

      // Full mesh merge: every replica receives every other replica's state.
      for (const a of replicas) {
        for (const b of replicas) {
          if (a !== b) a.applyUpdate(b.encodeState())
        }
      }

      const texts = replicas.map((r) => r.getText())
      // Convergence: all replicas agree.
      expect(texts[1], `trial ${trial.toString()} convergence`).toBe(texts[0])
      expect(texts[2], `trial ${trial.toString()} convergence`).toBe(texts[0])
      // No lost edits: every replica's sentinel is present in the converged text.
      for (const sentinel of SENTINELS) {
        expect(texts[0]?.includes(sentinel), `trial ${trial.toString()} kept ${sentinel}`).toBe(
          true,
        )
      }
      for (const r of replicas) r.destroy()
    }
  })

  it("converges regardless of merge order (commutative/idempotent merges)", () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = rng(trial + 500)
      const base = yjsEngine.open()
      base.setText("base", { actor: "base", kind: "human" })
      const start = base.encodeState()
      base.destroy()

      const a = yjsEngine.open(start)
      const b = yjsEngine.open(start)
      let ta = a.getText()
      let tb = b.getText()
      for (let e = 0; e < EDITS_PER_REPLICA; e++) {
        ta = randomEdit(ta, rand)
        a.setText(ta, { actor: "a", kind: "human" })
        tb = randomEdit(tb, rand)
        b.setText(tb, { actor: "b", kind: "human" })
      }
      const ua = a.encodeState()
      const ub = b.encodeState()
      // Merge in opposite orders, and twice (idempotent), into fresh docs.
      const m1 = yjsEngine.open()
      m1.applyUpdate(ua)
      m1.applyUpdate(ub)
      m1.applyUpdate(ua) // re-applying is a no-op
      const m2 = yjsEngine.open()
      m2.applyUpdate(ub)
      m2.applyUpdate(ua)
      expect(m2.getText(), `trial ${trial.toString()} order-independence`).toBe(m1.getText())
      for (const d of [a, b, m1, m2]) d.destroy()
    }
  })
})
