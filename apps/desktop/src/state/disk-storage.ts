import type { Invoke } from "../vault/tauri-vault"

/** The synchronous `Storage` slice the version store / session prefs / metrics recorders consume. */
export type SyncStorage = Pick<Storage, "getItem" | "setItem">

export interface DiskStorage {
  readonly storage: SyncStorage
  /** Resolves once queued write-throughs have settled (App flushes on hide, like the vault). */
  flush(): Promise<void>
}

/**
 * A `Storage`-shaped adapter backed by the per-workspace `<vault>/.spherewiki/state.json` (O3). It
 * makes the NON-derived durable state — version history, session prefs, AI metrics — live on disk
 * beside the `.md` notes, so it travels with the vault (copy / git-sync the folder and revert points
 * survive), instead of being stranded in webview localStorage. Strategy A, like the vault: hydrate an
 * in-memory mirror from `state_load` at boot (callers use `getItem`/`setItem` synchronously,
 * unchanged), write through the whole blob to `state_save` asynchronously. `invoke` is injected so
 * the adapter is unit-testable without the native runtime.
 */
export async function createDiskStorage(workspace: string, invoke: Invoke): Promise<DiskStorage> {
  const raw = await invoke<string>("state_load", { workspace })
  // Degrade to empty on a corrupt/foreign blob — never reject: this sidecar is meant to be
  // git/Dropbox-synced, so a MERGE CONFLICT in state.json (conflict markers aren't valid JSON) must
  // not fail vault boot and strand the user's real `.md` notes. Every other store hydrates this way.
  let parsed: unknown = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }
  const mirror = new Map<string, string>()
  if (parsed !== null && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") mirror.set(k, v)
    }
  }

  let tail: Promise<unknown> = Promise.resolve()
  const persist = (): void => {
    const blob = JSON.stringify(Object.fromEntries(mirror))
    tail = tail.then(() =>
      invoke<void>("state_save", { workspace, content: blob }).catch((error) =>
        console.error("[tauri] durable state failed to save to disk", error),
      ),
    )
  }

  return {
    storage: {
      getItem: (key) => mirror.get(key) ?? null,
      setItem: (key, value) => {
        mirror.set(key, value)
        persist()
      },
    },
    flush: () => tail.then(() => undefined),
  }
}
