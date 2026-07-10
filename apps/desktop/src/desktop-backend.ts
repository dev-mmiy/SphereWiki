import {
  createLocalEmbedder,
  type EmbeddingProvider,
  reindexWorkspace,
  type VectorIndex,
} from "@spherewiki/ai"
import { asWorkspaceId, type Vault } from "@spherewiki/shared"
import { createTauriVectorIndex } from "./index/duckdb-vector"
import { createDiskStorage, type SyncStorage } from "./state/disk-storage"
import { createTauriVault, type Invoke } from "./vault/tauri-vault"

/**
 * A SHARED workspace loaded READ-ONLY for a project's RAG scope (multi-project 2b): its own vault
 * (for citation bodies + the staleness check) and vector index (searched alongside the active
 * project's). The active project never writes here — the only cross-workspace bridge is this opt-in,
 * read-only inclusion. Its index is reindexed from its Markdown at load so retrieval is current.
 */
export interface SharedBackend {
  /** The shared workspace's id — so a scope change can drop a removed workspace synchronously. */
  readonly id: string
  readonly index: VectorIndex
  readonly vault: Vault
}

export interface DesktopBackend {
  readonly vault: Vault
  readonly index: VectorIndex
  readonly embedder: EmbeddingProvider
  /** Disk-backed durable state (version history, prefs, metrics) in `.spherewiki/` — travels with the vault. */
  readonly storage: SyncStorage
  /** Flush all pending disk write-throughs (App calls this on window hide / before unload). */
  flush(): Promise<void>
}

/** The included shared workspaces + a flush for their (reindexed) DuckDB indexes. Loaded and swapped
 * INDEPENDENTLY of the active backend, so changing a project's RAG scope never reloads its own vault
 * or remounts the workspace. */
export interface SharedScope {
  readonly shared: readonly SharedBackend[]
  flush(): Promise<void>
}

/**
 * The native-shell backend for the ACTIVE project: the on-disk `.md` vault + the per-workspace
 * DuckDB vector index, both hydrated from disk before use, plus the (shared) embedder they must agree
 * on, and the `.spherewiki/` durable-state store. `App` awaits this once per active project under
 * Tauri and injects the pieces into the hook. Its RAG SCOPE (the shared workspaces it includes) is
 * loaded separately via `loadSharedBackends`, so scope changes don't touch this. `invoke` is shared.
 */
export async function createDesktopBackend(
  workspace: string,
  seed: ReadonlyArray<{ title: string; body: string }>,
  invoke?: Invoke,
): Promise<DesktopBackend> {
  const bridge = invoke ?? (await import("@tauri-apps/api/core")).invoke
  const embedder = createLocalEmbedder()
  const [vaultHandle, indexHandle, diskStorage] = await Promise.all([
    createTauriVault(workspace, seed, bridge, {
      onWriteError: (error) => console.error("[tauri] a note failed to save to disk", error),
    }),
    createTauriVectorIndex(asWorkspaceId(workspace), embedder.info, bridge),
    createDiskStorage(workspace, bridge),
  ])
  return {
    vault: vaultHandle.vault,
    index: indexHandle.index,
    embedder,
    storage: diskStorage.storage,
    flush: () =>
      Promise.all([vaultHandle.flush(), indexHandle.flush(), diskStorage.flush()]).then(
        () => undefined,
      ),
  }
}

/**
 * Load a project's included `shared` workspaces (its `ragIncludes`) READ-ONLY for RAG — each its own
 * `vaults/<id>/` vault + DuckDB index, with the index reindexed from its Markdown once here (so an
 * "Ask" can cite shared knowledge without a per-query rebuild). Loaded independently of the active
 * backend so it can be re-run in place when the scope changes. Fail-soft + isolated:
 *  - a bad include (missing dir, corrupt/locked DuckDB, unreadable note) is dropped from the scope,
 *    NEVER failing the whole load (which must never take the active project down with it), and
 *  - shared vaults are opened through a no-write, trash-blind FsPort, so a consumer can never mutate
 *    another workspace's Markdown.
 */
export async function loadSharedBackends(
  sharedIds: readonly string[],
  invoke?: Invoke,
): Promise<SharedScope> {
  const bridge = invoke ?? (await import("@tauri-apps/api/core")).invoke
  const embedder = createLocalEmbedder()
  const handles = await Promise.all(
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
        return { id, vaultH, indexH }
      } catch (error) {
        console.error(
          `[tauri] shared workspace "${id}" failed to load; dropping it from RAG scope`,
          error,
        )
        return null
      }
    }),
  )
  const loaded = handles.filter((h): h is NonNullable<typeof h> => h !== null)
  return {
    shared: loaded.map((h) => ({ id: h.id, index: h.indexH.index, vault: h.vaultH.vault })),
    // The shared indexes were written by the load-time reindex; persist them on flush.
    flush: () => Promise.all(loaded.map((h) => h.indexH.flush())).then(() => undefined),
  }
}
