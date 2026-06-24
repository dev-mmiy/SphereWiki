import { asNoteId, asWorkspaceId } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { contentHash } from "../embedding/hash"
import type { EmbeddingModelInfo } from "../embedding/types"
import { createMemoryVectorIndex } from "./memory"
import type { EmbeddingRecord, ReadonlyVectorIndex } from "./types"

const MODEL: EmbeddingModelInfo = { model: "test", dimension: 3 }
const ws = asWorkspaceId("ws1")

function rec(id: string, vector: number[], text = id): EmbeddingRecord {
  return { noteId: asNoteId(id), title: id, vector, contentHash: contentHash(text) }
}

describe("createMemoryVectorIndex", () => {
  it("returns a note's own vector with the top score", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    index.upsert(rec("n1", [1, 0, 0]))
    index.upsert(rec("n2", [0, 1, 0]))
    const hits = index.search([1, 0, 0], 5)
    expect(hits[0]?.noteId).toBe(asNoteId("n1"))
    expect(hits[0]?.score).toBeCloseTo(1, 5)
  })

  it("removes and clears", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    index.upsert(rec("n1", [1, 0, 0]))
    index.remove(asNoteId("n1"))
    expect(index.records()).toHaveLength(0)
    index.upsert(rec("n2", [0, 1, 0]))
    index.clear()
    expect(index.records()).toHaveLength(0)
  })

  it("respects k and sorts by score desc with a stable noteId tie-break", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    index.upsert(rec("b", [1, 0, 0]))
    index.upsert(rec("a", [1, 0, 0]))
    index.upsert(rec("c", [0, 1, 0]))
    const hits = index.search([1, 0, 0], 2)
    expect(hits.map((h) => h.noteId)).toEqual([asNoteId("a"), asNoteId("b")])
  })

  it("is idempotent across a re-upsert (records byte-identical)", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    index.upsert(rec("n1", [1, 0, 0]))
    const first = index.records()
    index.upsert(rec("n1", [1, 0, 0]))
    expect(index.records()).toEqual(first)
  })

  it("exposes hashOf, undefined for unknown notes", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    index.upsert(rec("n1", [1, 0, 0], "body text"))
    expect(index.hashOf(asNoteId("n1"))).toBe(contentHash("body text"))
    expect(index.hashOf(asNoteId("nope"))).toBeUndefined()
  })

  it("carries the stored content hash on hits", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    index.upsert(rec("n1", [1, 0, 0], "body text"))
    expect(index.search([1, 0, 0], 1)[0]?.contentHash).toBe(contentHash("body text"))
  })

  it("throws on a vector/query dimension mismatch", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    expect(() => index.upsert(rec("n1", [1, 0]))).toThrow()
    expect(() => index.search([1, 0], 1)).toThrow()
  })

  it("isolates state per workspace", () => {
    const a = createMemoryVectorIndex(asWorkspaceId("a"), MODEL)
    const b = createMemoryVectorIndex(asWorkspaceId("b"), MODEL)
    a.upsert(rec("n1", [1, 0, 0]))
    expect(b.records()).toHaveLength(0)
    expect(a.workspaceId).toBe(asWorkspaceId("a"))
  })

  it("forbids cross-workspace access and writes via a read-only view (compile-time)", () => {
    const index = createMemoryVectorIndex(ws, MODEL)
    const guards = (): void => {
      // @ts-expect-error no VectorIndex method accepts a workspaceId — isolation is sealed at construction
      index.search([1, 0, 0], 1, ws)
      const ro: ReadonlyVectorIndex = index
      // @ts-expect-error a ReadonlyVectorIndex (e.g. a shared workspace) cannot be written
      ro.upsert(rec("n1", [1, 0, 0]))
    }
    expect(typeof guards).toBe("function") // assertions are compile-time only; never invoked
  })
})
