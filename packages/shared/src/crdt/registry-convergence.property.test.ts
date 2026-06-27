import { describe, expect, it } from "vitest"
import type { CrdtRegistry, EditOrigin } from "./types"
import { openYjsRegistry } from "./yjs"

/**
 * Property/fuzz tests for the note-list data-safety invariant: the workspace **note-registry CRDT
 * converges across peers with no lost note**. Over many seeded trials, N replicas fork a common
 * registry and each makes random concurrent `set`s (create / rename / soft-delete tombstone) over a
 * small shared id space — forcing same-key conflicts — then mesh-merge. Every replica must converge
 * to identical entries, and every id any replica ever set must survive (the note list is additive:
 * deletion is a tombstone `set`, never a Y.Map delete). Deterministic; failing trials reproduce
 * from their seed.
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

/** Deterministic, order-independent view of a registry for cross-replica equality. */
function normalize(reg: CrdtRegistry): Array<[string, string, boolean]> {
  return [...reg.entries()]
    .map(([id, e]): [string, string, boolean] => [id, e.title, e.deleted === true])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

const TRIALS = 50
const REPLICAS = 3
const OPS_PER_REPLICA = 6
const ID_SPACE = 5 // small, so concurrent same-key sets (LWW conflicts) are frequent

describe("note-registry convergence (property)", () => {
  it("converges across replicas with no lost note under concurrent sets", () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = rng(trial + 1)

      // A common starting registry all replicas fork from.
      const base = openYjsRegistry()
      base.set("n0", { title: "seed" }, { actor: "base", kind: "human" })
      const start = base.encodeState()
      base.destroy()

      const allIds = new Set<string>(["n0"])
      const replicas = Array.from({ length: REPLICAS }, (_, i) => {
        const reg = openYjsRegistry(start)
        const origin: EditOrigin = { actor: `r${i.toString()}`, kind: "human" }
        for (let o = 0; o < OPS_PER_REPLICA; o++) {
          const id = `n${Math.floor(rand() * ID_SPACE).toString()}`
          allIds.add(id)
          const title = `t${Math.floor(rand() * 1000).toString()}`
          // ~30% of writes are soft-delete tombstones (the note-list's delete).
          const entry = rand() < 0.3 ? { title, deleted: true } : { title }
          reg.set(id, entry, origin)
        }
        return reg
      })

      // Full mesh merge: every replica receives every other replica's state.
      for (const a of replicas) {
        for (const b of replicas) {
          if (a !== b) a.applyUpdate(b.encodeState())
        }
      }

      // Convergence: all replicas agree on the entire entry set.
      const reference = normalize(replicas[0] as CrdtRegistry)
      for (let i = 1; i < replicas.length; i++) {
        expect(
          normalize(replicas[i] as CrdtRegistry),
          `trial ${trial.toString()} convergence`,
        ).toEqual(reference)
      }
      // No lost note: every id ever set is still a key (sets are additive; tombstones keep the key).
      const convergedKeys = new Set(reference.map(([id]) => id))
      expect(convergedKeys, `trial ${trial.toString()} no lost note`).toEqual(allIds)

      for (const r of replicas) r.destroy()
    }
  })
})
