import { describe, expect, it } from "vitest"
import { asNoteId } from "../types"
import { createFileBackedVault, type FsPort } from "./file"

/**
 * Property/fuzz tests for the file-backed vault's data-safety invariants — the ones the adversarial
 * review showed are easy to break: (1) over any random sequence of create/write/rename/ensure, every
 * note survives a reload with its exact latest bytes and a stable id (no note lost, no id churn, no
 * collision clobber); (2) the serialized write-through queue never wedges under random transient
 * write failures (the critical data-loss bug: one rejected write silently dropping all later edits).
 * Deterministic — a failing trial is reproducible from its seed.
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

interface FakeFs extends FsPort {
  readonly store: Map<string, string>
}

/** In-memory FsPort. `shouldFailWrite`, when set, injects a transient writeFile rejection. */
function makeFakeFs(store = new Map<string, string>(), shouldFailWrite?: () => boolean): FakeFs {
  const dirOf = (dir: string) => (dir.endsWith("/") ? dir : `${dir}/`)
  return {
    store,
    readdir: async (dir) => {
      const prefix = dirOf(dir)
      const names = new Set<string>()
      for (const path of store.keys()) {
        if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split("/")[0] as string)
      }
      return [...names]
    },
    readFile: async (path) => {
      const value = store.get(path)
      if (value === undefined) throw new Error(`ENOENT: ${path}`)
      return value
    },
    writeFile: async (path, content) => {
      if (shouldFailWrite?.()) throw new Error("EIO (injected transient failure)")
      store.set(path, content)
    },
    rename: async (from, to) => {
      const value = store.get(from)
      if (value === undefined) throw new Error(`ENOENT: ${from}`)
      store.set(to, value)
      store.delete(from)
    },
    mkdir: async () => {},
  }
}

// A pool of titles that stress the slug / collision / normalization / CJK paths. Duplicates and
// case/normalization variants are intentional so filename collisions actually happen.
const TITLES = [
  "Home",
  "Note",
  "note", // case variant of "Note" (APFS-collision)
  "café", // composed
  "café", // decomposed (NFD) form of "café"
  "メモ",
  "a/b:c", // fs-illegal chars
  "   ", // whitespace-only -> "untitled"
  "Ideas",
  "Ideas", // exact duplicate title
]

const TRIALS = 60
const OPS_PER_TRIAL = 14

describe("file-backed vault (property)", () => {
  it("loses no note across a random op sequence + reload (ids stable, bytes exact)", async () => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = rng(trial + 1)
      const store = new Map<string, string>()
      const first = createFileBackedVault({
        fs: makeFakeFs(store),
        root: "/w",
        newId: (() => {
          let n = 0
          return () => `t${trial}-${(++n).toString()}`
        })(),
      })
      await first.whenLoaded

      // oracle: id -> the exact source read() should return (and disk should hold after flush).
      const oracle = new Map<string, string>()
      const ids = (): string[] => [...oracle.keys()]

      for (let op = 0; op < OPS_PER_TRIAL; op++) {
        const pick = rand()
        const title = TITLES[Math.floor(rand() * TITLES.length)] as string
        if (pick < 0.45 || oracle.size === 0) {
          // create
          const meta = first.vault.create(title, `# ${title}\nbody ${op}\n`)
          oracle.set(meta.id, first.vault.read(meta.id))
        } else if (pick < 0.7) {
          // write: append to the note's OWN source, so the id frontmatter rides along (verbatim)
          const id = ids()[Math.floor(rand() * oracle.size)] as string
          const next = `${first.vault.read(asNoteId(id))}\nedit ${op}`
          first.vault.write(asNoteId(id), next)
          oracle.set(id, next)
        } else if (pick < 0.9) {
          // rename to another (possibly colliding) title
          const id = ids()[Math.floor(rand() * oracle.size)] as string
          first.vault.rename(asNoteId(id), title)
          oracle.set(id, first.vault.read(asNoteId(id)))
        } else {
          // ensure at a fresh explicit id (insert-if-absent)
          const id = `ext-${trial}-${op}`
          first.vault.ensure(asNoteId(id), title, `# ${title}\next ${op}\n`)
          oracle.set(id, first.vault.read(asNoteId(id)))
        }
      }
      await first.flush()

      // Reload: a fresh instance over the same on-disk bytes (reopening the app offline).
      const second = createFileBackedVault({
        fs: makeFakeFs(store),
        root: "/w",
        newId: () => `reload-${trial}`,
      })
      await second.whenLoaded

      const loadedIds = new Set(second.vault.list().map((m) => m.id))
      expect(loadedIds).toEqual(new Set([...oracle.keys()].map((id) => asNoteId(id)))) // no loss/phantom
      for (const [id, expected] of oracle) {
        expect(second.vault.read(asNoteId(id))).toBe(expected) // exact bytes + stable id survive
      }
    }
  })

  it("never wedges the write queue under random transient write failures", async () => {
    let totalFailures = 0
    for (let trial = 0; trial < TRIALS; trial++) {
      const rand = rng(trial + 1000)
      const store = new Map<string, string>()
      let flaky = true
      const { vault, whenLoaded, flush } = createFileBackedVault({
        fs: makeFakeFs(store, () => flaky && rand() < 0.5), // ~half of writes fail while flaky
        root: "/w",
        newId: (() => {
          let n = 0
          return () => `f${trial}-${(++n).toString()}`
        })(),
        onWriteError: () => {
          totalFailures += 1 // failures are surfaced (not swallowed) and don't wedge the chain
        },
      })
      await whenLoaded

      // Hammer with random creates/writes while writes are failing at random.
      const created: string[] = []
      for (let op = 0; op < OPS_PER_TRIAL; op++) {
        if (created.length === 0 || rand() < 0.6) {
          created.push(vault.create(`N${op}`, `# N${op}\n`).id)
        } else {
          const id = created[Math.floor(rand() * created.length)] as string
          vault.write(asNoteId(id), `${vault.read(asNoteId(id))}\nx`)
        }
      }
      await flush()

      // Now the fs heals; a fresh write MUST still reach disk — i.e. the queue was not wedged by the
      // earlier rejections (the critical-bug regression, exercised across random failure patterns).
      flaky = false
      const sentinel = vault.create("SENTINEL", "# sentinel\n")
      await flush()

      expect(store.get("/w/SENTINEL.md")).toContain("sentinel") // later write still landed
      expect(vault.read(sentinel.id)).toContain("sentinel")
    }
    expect(totalFailures).toBeGreaterThan(0) // the failure path was actually exercised (not vacuous)
  })
})
