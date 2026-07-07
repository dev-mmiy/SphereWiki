import { createLocalEmbedder, type EmbeddingProvider, type VectorIndex } from "@spherewiki/ai"
import type { Vault, WorkspaceId } from "@spherewiki/shared"
import { createTauriVectorIndex } from "./index/duckdb-vector"
import { createTauriVault, type Invoke } from "./vault/tauri-vault"

export interface DesktopBackend {
  readonly vault: Vault
  readonly index: VectorIndex
  readonly embedder: EmbeddingProvider
  /** Flush all pending disk write-throughs (App calls this on window hide / before unload). */
  flush(): Promise<void>
}

/**
 * The native-shell backend: the on-disk `.md` vault + the per-workspace DuckDB vector index, both
 * hydrated from disk before use, plus the (shared) embedder they must agree on. `App` awaits this
 * once under Tauri and injects the pieces into the hook, so the workspace mounts against a ready
 * on-disk backend indistinguishable from the in-webview one. `invoke` is imported once and shared.
 */
export async function createDesktopBackend(
  workspace: WorkspaceId,
  seed: ReadonlyArray<{ title: string; body: string }>,
  invoke?: Invoke,
): Promise<DesktopBackend> {
  const bridge = invoke ?? (await import("@tauri-apps/api/core")).invoke
  const embedder = createLocalEmbedder()
  const [vaultHandle, indexHandle] = await Promise.all([
    createTauriVault(workspace, seed, bridge, {
      onWriteError: (error) => console.error("[tauri] a note failed to save to disk", error),
    }),
    createTauriVectorIndex(workspace, embedder.info, bridge),
  ])
  return {
    vault: vaultHandle.vault,
    index: indexHandle.index,
    embedder,
    flush: () => Promise.all([vaultHandle.flush(), indexHandle.flush()]).then(() => undefined),
  }
}
