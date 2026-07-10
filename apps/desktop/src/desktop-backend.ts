import {
  createLocalEmbedder,
  type EmbeddingProvider,
  reindexWorkspace,
  type VectorIndex,
} from "@spherewiki/ai"
import { asWorkspaceId, type Vault, type WorkspaceId } from "@spherewiki/shared"
import { createTauriVectorIndex } from "./index/duckdb-vector"
import { createDiskStorage, type SyncStorage } from "./state/disk-storage"
import { createTauriVault, type Invoke } from "./vault/tauri-vault"

/**
 * A SHARED workspace loaded READ-ONLY for the active project's RAG scope (multi-project 2b): its own
 * vault (for citation bodies + the staleness check) and vector index (searched alongside the active
 * project's). The active project never writes here — the only cross-workspace bridge is this opt-in,
 * read-only inclusion. Its index is reindexed from its Markdown at load so retrieval is current.
 */
export interface SharedBackend {
  readonly index: VectorIndex
  readonly vault: Vault
}

export interface DesktopBackend {
  readonly vault: Vault
  readonly index: VectorIndex
  readonly embedder: EmbeddingProvider
  /** Disk-backed durable state (version history, prefs, metrics) in `.spherewiki/` — travels with the vault. */
  readonly storage: SyncStorage
  /** Read-only indexes + vaults of the `shared` workspaces this project includes in its RAG scope. */
  readonly shared: readonly SharedBackend[]
  /** Flush all pending disk write-throughs (App calls this on window hide / before unload). */
  flush(): Promise<void>
}

/**
 * The native-shell backend: the on-disk `.md` vault + the per-workspace DuckDB vector index, both
 * hydrated from disk before use, plus the (shared) embedder they must agree on. `App` awaits this
 * once under Tauri and injects the pieces into the hook, so the workspace mounts against a ready
 * on-disk backend indistinguishable from the in-webview one. `invoke` is imported once and shared.
 *
 * `sharedIds` are the `shared` workspaces this project includes (its `ragIncludes`): each is loaded
 * read-only (vault + index) and its index reindexed from its Markdown once here, so an "Ask" can cite
 * shared knowledge without a per-query rebuild. They stay isolated — separate `vaults/<id>/` stores
 * the active project never writes.
 */
export async function createDesktopBackend(
  workspace: WorkspaceId,
  seed: ReadonlyArray<{ title: string; body: string }>,
  invoke?: Invoke,
  sharedIds: readonly string[] = [],
): Promise<DesktopBackend> {
  const bridge = invoke ?? (await import("@tauri-apps/api/core")).invoke
  const embedder = createLocalEmbedder()
  const [vaultHandle, indexHandle, diskStorage, sharedHandles] = await Promise.all([
    createTauriVault(workspace, seed, bridge, {
      onWriteError: (error) => console.error("[tauri] a note failed to save to disk", error),
    }),
    createTauriVectorIndex(workspace, embedder.info, bridge),
    createDiskStorage(workspace, bridge),
    // The included shared workspaces, opened READ-ONLY (empty seed → never seed someone else's vault;
    // a read-only FsPort → never mutate its Markdown, not even the core's id self-heal writeback).
    Promise.all(
      sharedIds.map(async (id) => {
        try {
          const wsId = asWorkspaceId(id)
          const [vaultH, indexH] = await Promise.all([
            createTauriVault(id, [], bridge, { readOnly: true }),
            createTauriVectorIndex(wsId, embedder.info, bridge),
          ])
          // Keep the shared index current with its Markdown once, at load (idempotent, hash-skips
          // unchanged notes) — so retrieval never serves stale text and finds new shared notes.
          await reindexWorkspace({ vault: vaultH.vault, index: indexH.index, embedder })
          return { vaultH, indexH }
        } catch (error) {
          // A shared include is an OPTIONAL, read-only RAG enhancement. One bad include (missing dir,
          // corrupt/locked DuckDB, unreadable note) must NEVER collapse the whole backend — that would
          // drop the ACTIVE project to its in-webview fallback and hide its real on-disk notes. Drop
          // just this include from the RAG scope; the active project + the good includes load normally.
          console.error(
            `[tauri] shared workspace "${id}" failed to load; dropping it from RAG scope`,
            error,
          )
          return null
        }
      }),
    ),
  ])
  const loadedShared = sharedHandles.filter((h): h is NonNullable<typeof h> => h !== null)
  return {
    vault: vaultHandle.vault,
    index: indexHandle.index,
    embedder,
    storage: diskStorage.storage,
    shared: loadedShared.map((h) => ({ index: h.indexH.index, vault: h.vaultH.vault })),
    flush: () =>
      Promise.all([
        vaultHandle.flush(),
        indexHandle.flush(),
        diskStorage.flush(),
        // The shared indexes were written by the load-time reindex; persist them too.
        ...loadedShared.map((h) => h.indexH.flush()),
      ]).then(() => undefined),
  }
}
