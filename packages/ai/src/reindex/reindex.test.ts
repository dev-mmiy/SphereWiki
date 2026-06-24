import { asNoteId, asWorkspaceId, createMemoryVault } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { contentHash } from "../embedding/hash"
import { createLocalEmbedder } from "../embedding/local"
import type { EmbeddingProvider } from "../embedding/types"
import { createMemoryVectorIndex } from "../index-store/memory"
import { reindexWorkspace } from "./reindex"

const embedder = createLocalEmbedder()
const ws = asWorkspaceId("ws1")

describe("reindexWorkspace", () => {
  it("builds the index from Markdown alone", async () => {
    const vault = createMemoryVault([
      { title: "A", body: "alpha beta gamma" },
      { title: "B", body: "delta epsilon" },
    ])
    const index = createMemoryVectorIndex(ws, embedder.info)
    const report = await reindexWorkspace({ vault, index, embedder })
    expect(report.embedded).toBe(2)
    expect(index.records()).toHaveLength(2)
  })

  it("is idempotent over unchanged Markdown", async () => {
    const vault = createMemoryVault([{ title: "A", body: "alpha beta" }])
    const index = createMemoryVectorIndex(ws, embedder.info)
    await reindexWorkspace({ vault, index, embedder })
    const first = index.records()
    const report = await reindexWorkspace({ vault, index, embedder })
    expect(report.skipped).toBe(1)
    expect(report.embedded).toBe(0)
    expect(index.records()).toEqual(first)
  })

  it("re-embeds a changed body", async () => {
    const vault = createMemoryVault([{ title: "A", body: "alpha" }])
    const meta = vault.list()[0]
    if (meta === undefined) throw new Error("seed failed")
    const index = createMemoryVectorIndex(ws, embedder.info)
    await reindexWorkspace({ vault, index, embedder })
    vault.write(meta.id, "alpha beta gamma changed")
    const report = await reindexWorkspace({ vault, index, embedder })
    expect(report.embedded).toBe(1)
    expect(report.skipped).toBe(0)
  })

  it("prunes notes absent from the vault", async () => {
    const vault = createMemoryVault([{ title: "A", body: "alpha" }])
    const index = createMemoryVectorIndex(ws, embedder.info)
    const [vector] = await embedder.embed(["stale ghost note"])
    if (vector === undefined) throw new Error("no vector")
    index.upsert({
      noteId: asNoteId("ghost"),
      title: "ghost",
      vector,
      contentHash: contentHash("stale ghost note"),
    })
    const report = await reindexWorkspace({ vault, index, embedder })
    expect(report.removed).toBe(1)
    expect(index.hashOf(asNoteId("ghost"))).toBeUndefined()
  })

  it("force actually re-invokes the embedder for unchanged notes", async () => {
    let calls = 0
    const counting: EmbeddingProvider = {
      info: embedder.info,
      embed: (texts) => {
        calls += texts.length
        return embedder.embed(texts)
      },
    }
    const vault = createMemoryVault([{ title: "A", body: "alpha" }])
    const index = createMemoryVectorIndex(ws, embedder.info)
    await reindexWorkspace({ vault, index, embedder: counting })
    const afterFirst = calls
    await reindexWorkspace({ vault, index, embedder: counting }) // unchanged -> skipped -> no embed
    expect(calls).toBe(afterFirst)
    await reindexWorkspace({ vault, index, embedder: counting, force: true }) // force -> embed again
    expect(calls).toBe(afterFirst + 1)
  })

  it("handles an empty vault", async () => {
    const vault = createMemoryVault([])
    const index = createMemoryVectorIndex(ws, embedder.info)
    const report = await reindexWorkspace({ vault, index, embedder })
    expect(report).toEqual({ embedded: 0, skipped: 0, removed: 0 })
    expect(index.records()).toHaveLength(0)
  })
})
