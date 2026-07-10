import { createFileBackedVault, type FileBackedVault, type FsPort } from "@spherewiki/shared"

/** The Tauri `invoke` signature (injected so the adapter is unit-testable without the runtime). */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/**
 * An `FsPort` backed by the workspace-scoped Rust vault commands (M2b.3). The core deals in
 * **root-relative** paths (`"Home.md"`, `"work/Foo.md"`); the Rust side resolves them under one dir
 * per `workspace`, validating each stays within it — isolation is enforced in Rust, not by trusting
 * the path here. Notes may live in subfolders (`vault_list_files` walks recursively).
 */
export function createTauriFsPort(workspace: string, invoke: Invoke): FsPort {
  return {
    listFiles: () => invoke<string[]>("vault_list_files", { workspace }),
    readFile: (path) => invoke<string>("vault_read_file", { workspace, path }),
    writeFile: (path, content) => invoke<void>("vault_write_file", { workspace, path, content }),
    rename: (from, to) => invoke<void>("vault_rename_file", { workspace, from, to }),
    // Soft-delete on disk (O2): the Rust commands move the file to/from a vault-root `.trash/`,
    // preserving its subpath (so it restores to the same folder).
    trash: (path) => invoke<void>("vault_trash_file", { workspace, path }),
    untrash: (path) => invoke<void>("vault_untrash_file", { workspace, path }),
    listTrash: () => invoke<string[]>("vault_list_trash", { workspace }),
    readTrash: (path) => invoke<string>("vault_read_trash", { workspace, path }),
  }
}

/**
 * Wrap an `FsPort` so every disk-MUTATING op is a no-op — the LIVE Markdown reads pass through
 * unchanged. A project that INCLUDES a `shared` workspace for RAG opens it through this, so it can
 * never write another workspace's Markdown. Crucially this suppresses the vault core's id self-heal
 * writeback (an id-less note gets a session-local id in memory, which is all retrieval needs) — the
 * shared workspace's own app remains the sole writer of its source of truth. (Its derived DuckDB
 * index is still rebuilt from that Markdown; only Markdown writes are suppressed here.)
 *
 * It is also TRASH-BLIND: `listTrash`/`readTrash` are omitted, so a consumer's hydrate loads only the
 * shared workspace's LIVE notes — matching the Markdown-only `reindex` intent (trashed notes are
 * pruned from the vector index), so a deleted shared note can never surface as a RAG citation.
 */
export function readOnlyFsPort(port: FsPort): FsPort {
  const noWrite = async (): Promise<void> => undefined
  return {
    listFiles: port.listFiles.bind(port),
    readFile: port.readFile.bind(port),
    writeFile: noWrite,
    rename: noWrite,
    trash: noWrite,
    untrash: noWrite,
    // listTrash / readTrash intentionally omitted → the shared vault is trash-blind (see above).
  }
}

/**
 * Build the on-disk file-backed vault for a workspace under the native shell and hydrate it before
 * returning, so callers receive a vault whose `list()`/`read()` already reflect disk (a drop-in for
 * the synchronously-constructed localStorage vault). `@tauri-apps/api` is imported dynamically so
 * the web bundle never loads it.
 */
export interface TauriVaultOptions {
  readonly newId?: () => string
  /** Called when a disk write-through fails, so the failure isn't silently swallowed (M2b.2's
   * per-op isolation keeps later writes flowing, but a dropped op still needs a signal). */
  readonly onWriteError?: (error: unknown) => void
  /** Open the vault READ-ONLY: every disk-mutating op (incl. the core's id self-heal writeback) is
   * suppressed, so a consumer can search a SHARED workspace's notes without mutating its Markdown. */
  readonly readOnly?: boolean
}

/**
 * Build the on-disk file-backed vault for a workspace and hydrate it before returning, so callers
 * receive a vault whose `list()`/`read()` already reflect disk (a drop-in for the synchronously
 * constructed localStorage vault). `invoke` is injected (the caller owns the `@tauri-apps/api`
 * import) so this stays unit-testable without the native runtime.
 */
export async function createTauriVault(
  workspace: string,
  seed: ReadonlyArray<{ title: string; body: string }>,
  invoke: Invoke,
  options: TauriVaultOptions = {},
): Promise<FileBackedVault> {
  const port = createTauriFsPort(workspace, invoke)
  const backed = createFileBackedVault({
    fs: options.readOnly === true ? readOnlyFsPort(port) : port,
    seed,
    ...(options.newId !== undefined ? { newId: options.newId } : {}),
    ...(options.onWriteError !== undefined ? { onWriteError: options.onWriteError } : {}),
  })
  await backed.whenLoaded
  return backed
}
