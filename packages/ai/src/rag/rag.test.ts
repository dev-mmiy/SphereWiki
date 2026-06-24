import { asNoteId, asWorkspaceId, type NoteId } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { contentHash } from "../embedding/hash"
import { createLocalEmbedder } from "../embedding/local"
import { createMemoryVectorIndex } from "../index-store/memory"
import type { VectorIndex } from "../index-store/types"
import { createExtractiveAnswerer } from "./extractive-answerer"
import { createRagRetriever } from "./retriever"

const embedder = createLocalEmbedder()
const ws = asWorkspaceId("proj")
const sharedWs = asWorkspaceId("shared")
const otherWs = asWorkspaceId("other")

const BODIES: Record<string, string> = {
  n1: "cats and dogs are common household pets",
  n2: "distributed systems consensus and the raft protocol",
  s1: "company travel reimbursement policy and limits",
  x1: "another project secret note also about pets",
}

async function seed(index: VectorIndex, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const body = BODIES[id]
    if (body === undefined) throw new Error(`no body for ${id}`)
    const [vector] = await embedder.embed([body])
    if (vector === undefined) throw new Error("no vector")
    index.upsert({ noteId: asNoteId(id), title: id, vector, contentHash: contentHash(body) })
  }
}

function readBody(id: NoteId): string {
  const body = BODIES[id]
  if (body === undefined) throw new Error(`no body for ${id}`)
  return body
}

describe("RAG retriever", () => {
  it("returns only project notes when no shared index is given", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n1", "n2"])
    const retriever = createRagRetriever({ embedder, project, readBody })
    const hits = await retriever.retrieve({ text: "pets at home", k: 5 })
    expect(hits[0]?.noteId).toBe(asNoteId("n1"))
    expect(hits[0]?.text).toBe(BODIES.n1)
  })

  it("includes a shared note only when its index is passed", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n1"])
    const shared = createMemoryVectorIndex(sharedWs, embedder.info)
    await seed(shared, ["s1"])
    const retriever = createRagRetriever({ embedder, project, shared: [shared], readBody })
    const hits = await retriever.retrieve({ text: "travel reimbursement policy" })
    expect(hits.map((h) => h.noteId)).toContain(asNoteId("s1"))
  })

  it("never retrieves a different workspace's notes (isolation)", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n1"])
    const other = createMemoryVectorIndex(otherWs, embedder.info)
    await seed(other, ["x1"])
    const retriever = createRagRetriever({ embedder, project, readBody })
    const hits = await retriever.retrieve({ text: "pets", k: 10 })
    expect(hits.map((h) => h.noteId)).not.toContain(asNoteId("x1"))
  })

  it("does not serve a hit whose embedding is stale (invariant 7)", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n1"])
    // The note's body changed since it was embedded; readBody returns the new text.
    const staleRead = (): string => "an entirely different body than what was embedded"
    const retriever = createRagRetriever({ embedder, project, readBody: staleRead })
    const hits = await retriever.retrieve({ text: "pets", k: 5 })
    expect(hits).toHaveLength(0)
  })

  it("ranks a strong shared hit above a weak project hit (cross-index)", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n2"]) // distributed systems — weak match for the query below
    const shared = createMemoryVectorIndex(sharedWs, embedder.info)
    await seed(shared, ["s1"]) // travel reimbursement — strong match
    const retriever = createRagRetriever({ embedder, project, shared: [shared], readBody })
    const hits = await retriever.retrieve({ text: "travel reimbursement policy limits", k: 5 })
    expect(hits[0]?.noteId).toBe(asNoteId("s1"))
  })

  it("de-duplicates a noteId present in both project and shared", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n1"])
    const shared = createMemoryVectorIndex(sharedWs, embedder.info)
    await seed(shared, ["n1"]) // same id in both indexes
    const retriever = createRagRetriever({ embedder, project, shared: [shared], readBody })
    const hits = await retriever.retrieve({ text: "pets", k: 5 })
    expect(hits.filter((h) => h.noteId === asNoteId("n1"))).toHaveLength(1)
  })

  it("forbids writing a shared (read-only) index (compile-time)", () => {
    const guard = (deps: Parameters<typeof createRagRetriever>[0]): void => {
      const ro = deps.shared?.[0]
      // @ts-expect-error shared workspaces enter RAG read-only and cannot be written
      ro?.upsert({ noteId: asNoteId("z"), title: "z", vector: [], contentHash: contentHash("z") })
    }
    expect(typeof guard).toBe("function") // compile-time only; never invoked
  })
})

describe("extractive answerer", () => {
  it("composes a cited answer only from retrieved chunks", async () => {
    const project = createMemoryVectorIndex(ws, embedder.info)
    await seed(project, ["n1", "n2"])
    const retriever = createRagRetriever({ embedder, project, readBody })
    const answerer = createExtractiveAnswerer()
    const chunks = await retriever.retrieve({ text: "pets", k: 2 })
    const result = await answerer.answer("what about pets?", chunks)
    expect(result.citations).toEqual(chunks)
    for (const chunk of chunks) expect(result.answer).toContain(chunk.text)
    expect(result.answer).toContain("[1]")
  })
})
