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
  const backed = createFileBackedVault({
    fs: createTauriFsPort(workspace, invoke),
    seed,
    ...(options.newId !== undefined ? { newId: options.newId } : {}),
    ...(options.onWriteError !== undefined ? { onWriteError: options.onWriteError } : {}),
  })
  await backed.whenLoaded
  return backed
}
