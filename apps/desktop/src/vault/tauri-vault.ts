import { createFileBackedVault, type FileBackedVault, type FsPort } from "@spherewiki/shared"

/** The Tauri `invoke` signature (injected so the adapter is unit-testable without the runtime). */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/** The filename from a "/"-joined vault path (the core joins `root` + name; Rust scopes by name). */
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/**
 * An `FsPort` backed by the workspace-scoped Rust vault commands (M2b.3). The core hands "/"-joined
 * paths under a logical `root`; the Rust side resolves everything under one dir per `workspace`, so
 * only the filename is forwarded (isolation is enforced in Rust, not by trusting the path here).
 */
export function createTauriFsPort(workspace: string, invoke: Invoke): FsPort {
  return {
    readdir: () => invoke<string[]>("vault_list_files", { workspace }),
    readFile: (path) => invoke<string>("vault_read_file", { workspace, name: basename(path) }),
    writeFile: (path, content) =>
      invoke<void>("vault_write_file", { workspace, name: basename(path), content }),
    rename: (from, to) =>
      invoke<void>("vault_rename_file", { workspace, from: basename(from), to: basename(to) }),
    // The Rust side `create_dir_all`s on write, so the dir is materialized lazily — nothing to do.
    mkdir: async () => {},
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

export async function createTauriVault(
  workspace: string,
  seed: ReadonlyArray<{ title: string; body: string }>,
  options: TauriVaultOptions = {},
): Promise<FileBackedVault> {
  const { invoke } = await import("@tauri-apps/api/core")
  const backed = createFileBackedVault({
    fs: createTauriFsPort(workspace, invoke),
    root: workspace,
    seed,
    ...(options.newId !== undefined ? { newId: options.newId } : {}),
    ...(options.onWriteError !== undefined ? { onWriteError: options.onWriteError } : {}),
  })
  await backed.whenLoaded
  return backed
}
