import { contentHash, type EmbeddingModelInfo, type EmbeddingRecord } from "@spherewiki/ai"
import { asNoteId, asWorkspaceId } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import type { Invoke } from "../vault/tauri-vault"
import { createTauriVectorIndex } from "./duckdb-vector"

const MODEL: EmbeddingModelInfo = { model: "test", dimension: 3 }
const ws = asWorkspaceId("ws-dev")

function rec(id: string, vector: number[]): EmbeddingRecord {
  return { noteId: asNoteId(id), title: id, vector, contentHash: contentHash(id) }
}

/**
 * A faithful in-memory stand-in for the Rust `vector_*` commands: one record store per workspace,
 * `vec` round-tripping through JSON like the DuckDB TEXT column — so the facade + hydration + write-
 * through can be exercised end-to-end without the native runtime. `records` returns the camelCase
 * shape the real command serializes (`noteId`/`contentHash`).
 */
function fakeVectorBackend(): {
  invoke: Invoke
  store: Map<
    string,
    Map<string, { noteId: string; title: string; vector: number[]; contentHash: string }>
  >
} {
  const store = new Map<
    string,
    Map<string, { noteId: string; title: string; vector: number[]; contentHash: string }>
  >()
  const dir = (ws: string) => {
    let d = store.get(ws)
    if (d === undefined) {
      d = new Map()
      store.set(ws, d)
    }
    return d
  }
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    const a = (args ?? {}) as {
      workspace: string
      noteId?: string
      title?: string
      vector?: number[]
      contentHash?: string
    }
    const d = dir(a.workspace)
    switch (cmd) {
      case "vector_records":
        return [...d.values()].sort((x, y) => (x.noteId < y.noteId ? -1 : 1))
      case "vector_upsert":
        d.set(a.noteId as string, {
          noteId: a.noteId as string,
          title: a.title as string,
          vector: JSON.parse(JSON.stringify(a.vector)), // model the JSON TEXT round-trip
          contentHash: a.contentHash as string,
        })
        return undefined
      case "vector_remove":
        d.delete(a.noteId as string)
        return undefined
      case "vector_clear":
        d.clear()
        return undefined
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  }) as Invoke
  return { invoke, store }
}

describe("createTauriVectorIndex (DuckDB facade over a simulated Rust backend)", () => {
  it("persists upserts and rehydrates them across a reopen (records + search survive)", async () => {
    const { invoke, store } = fakeVectorBackend()
    const first = await createTauriVectorIndex(ws, MODEL, invoke)
    first.index.upsert(rec("n1", [1, 0, 0]))
    first.index.upsert(rec("n2", [0, 1, 0]))
    await first.flush()

    // The backend now holds both records.
    expect(store.get("ws-dev")?.size).toBe(2)

    // A fresh facade over the same backend = relaunching the app.
    const second = await createTauriVectorIndex(ws, MODEL, invoke)
    expect(second.index.records().map((r) => r.noteId)).toEqual([asNoteId("n1"), asNoteId("n2")])
    // search reuses the memory impl's exact ranking + tie-break.
    const hits = second.index.search([1, 0, 0], 5)
    expect(hits[0]?.noteId).toBe(asNoteId("n1"))
    expect(hits[0]?.score).toBeCloseTo(1, 5)
    expect(second.index.hashOf(asNoteId("n1"))).toBe(contentHash("n1"))
  })

  it("write-through mirrors remove and clear to the backend", async () => {
    const { invoke, store } = fakeVectorBackend()
    const { index, flush } = await createTauriVectorIndex(ws, MODEL, invoke)
    index.upsert(rec("n1", [1, 0, 0]))
    index.upsert(rec("n2", [0, 1, 0]))
    index.remove(asNoteId("n1"))
    await flush()
    expect([...(store.get("ws-dev")?.keys() ?? [])]).toEqual(["n2"])

    index.clear()
    await flush()
    expect(store.get("ws-dev")?.size).toBe(0)
  })

  it("rejects an upsert whose vector dimension != the model (never persists it)", async () => {
    const { invoke, store } = fakeVectorBackend()
    const { index } = await createTauriVectorIndex(ws, MODEL, invoke)
    expect(() => index.upsert(rec("bad", [1, 0]))).toThrow(/dimension/)
    expect(store.get("ws-dev")?.size ?? 0).toBe(0) // the invalid vector never reached the backend
  })

  it("skips a stored vector whose dimension no longer matches the model on hydrate", async () => {
    const { invoke, store } = fakeVectorBackend()
    // Simulate a prior model (2-dim) leaving a stale record on disk.
    store.set(
      "ws-dev",
      new Map([["old", { noteId: "old", title: "old", vector: [1, 0], contentHash: "h" }]]),
    )
    const { index } = await createTauriVectorIndex(ws, MODEL, invoke) // MODEL is 3-dim
    expect(index.records()).toEqual([]) // the mismatched record is dropped, not fed into the mirror
  })

  it("is sealed to its workspace — a different workspace sees none of its vectors", async () => {
    const { invoke } = fakeVectorBackend()
    const a = await createTauriVectorIndex(asWorkspaceId("ws-a"), MODEL, invoke)
    a.index.upsert(rec("n1", [1, 0, 0]))
    await a.flush()
    const b = await createTauriVectorIndex(asWorkspaceId("ws-b"), MODEL, invoke)
    expect(b.index.records()).toEqual([])
  })
})
