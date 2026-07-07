import {
  type ContentHash,
  createMemoryVectorIndex,
  type EmbeddingModelInfo,
  type EmbeddingRecord,
  type VectorIndex,
} from "@spherewiki/ai"
import { asNoteId, type WorkspaceId } from "@spherewiki/shared"
import type { Invoke } from "../vault/tauri-vault"

export interface DuckDbVectorIndex {
  readonly index: VectorIndex
  /** Resolves once queued write-throughs have settled (App flushes on hide, like the vault). */
  flush(): Promise<void>
}

/** A stored record as `vector_records` returns it (VectorRecord serialized camelCase). */
interface StoredRecord {
  readonly noteId: string
  readonly title: string
  readonly vector: number[]
  readonly contentHash: string
}

/**
 * A DuckDB-backed `VectorIndex` for the native shell (M2b.4) — the first per-workspace DuckDB store.
 * Strategy A, mirroring the file vault: hydrate an in-memory index from DuckDB once, then serve
 * `search`/`records`/`hashOf` from it (so the exact cosine ranking + tie-break of the memory impl is
 * reused byte-for-byte) while `upsert`/`remove`/`clear` write through to DuckDB asynchronously.
 * Sealed to one workspace (no method takes a workspaceId) and rooted at one `.duckdb` file per
 * workspace — project isolation by construction; the cosine ranking + contentHash stay in TS (D3/D8).
 */
export async function createTauriVectorIndex(
  workspace: WorkspaceId,
  model: EmbeddingModelInfo,
  invoke: Invoke,
): Promise<DuckDbVectorIndex> {
  const mem = createMemoryVectorIndex(workspace, model)
  const stored = await invoke<StoredRecord[]>("vector_records", { workspace })
  for (const r of stored) {
    // Skip a stored vector whose dimension no longer matches the model (a model swap at M4b) — it
    // is stale and will be re-embedded; never feed a mismatched vector into the mirror.
    if (r.vector.length !== model.dimension) continue
    mem.upsert({
      noteId: asNoteId(r.noteId),
      title: r.title,
      vector: r.vector,
      contentHash: r.contentHash as ContentHash,
    })
  }

  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = (op: () => Promise<void>): void => {
    // Each op isolated (like the file vault) so one failed write can't wedge the queue or go silent.
    tail = tail.then(() =>
      op().catch((error) => console.error("[tauri] vector write failed", error)),
    )
  }
  const flush = (): Promise<void> => tail.then(() => undefined)

  const index: VectorIndex = {
    workspaceId: mem.workspaceId,
    model: mem.model,
    search: (query, k) => mem.search(query, k),
    hashOf: (noteId) => mem.hashOf(noteId),
    records: () => mem.records(),
    upsert: (record: EmbeddingRecord) => {
      mem.upsert(record) // dimension-checked; throws before we ever persist an invalid vector
      enqueue(() =>
        invoke<void>("vector_upsert", {
          workspace,
          noteId: record.noteId,
          title: record.title,
          vector: [...record.vector],
          contentHash: record.contentHash,
        }),
      )
    },
    remove: (noteId) => {
      mem.remove(noteId)
      enqueue(() => invoke<void>("vector_remove", { workspace, noteId }))
    },
    clear: () => {
      mem.clear()
      enqueue(() => invoke<void>("vector_clear", { workspace }))
    },
  }
  return { index, flush }
}
