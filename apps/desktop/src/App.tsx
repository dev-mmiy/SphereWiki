import type { FileBackedVault } from "@spherewiki/shared"
import { useEffect, useRef, useState } from "react"
import { WORKSPACE_ID } from "./auth-local"
import { NoteWorkspace } from "./editor/NoteWorkspace"
import { SEED } from "./editor/use-vault-workspace"
import { isTauri } from "./seams"
import { createTauriVault } from "./vault/tauri-vault"

// The app shell (top bar + 3-pane layout) lives in NoteWorkspace. Under the native Tauri shell App
// first builds the on-disk `.md` vault and hydrates it before mounting the workspace (so the hook
// gets a ready vault, indistinguishable from the synchronous localStorage one). In the browser this
// is a no-op: `handle` starts null and NoteWorkspace mounts immediately with its localStorage vault.
export function App() {
  // `undefined` = still hydrating the on-disk vault (native only); `null` = browser / not-yet.
  const [handle, setHandle] = useState<FileBackedVault | null | undefined>(() =>
    isTauri() ? undefined : null,
  )
  const handleRef = useRef<FileBackedVault | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    let alive = true
    createTauriVault(WORKSPACE_ID, SEED, {
      onWriteError: (error) => console.error("[tauri] a note failed to save to disk", error),
    }).then(
      (built) => {
        if (!alive) return
        handleRef.current = built
        setHandle(built)
      },
      (error) => {
        // If the native vault can't be built, fall back to the browser vault rather than hang.
        console.error("[tauri] on-disk vault init failed; using in-webview storage", error)
        if (alive) setHandle(null)
      },
    )
    // Pending disk write-throughs are async; flush them when the window is hidden/closed so the last
    // edit isn't lost on a quick quit.
    const flush = () => void handleRef.current?.flush()
    document.addEventListener("visibilitychange", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      alive = false
      document.removeEventListener("visibilitychange", flush)
      window.removeEventListener("beforeunload", flush)
    }
  }, [])

  if (handle === undefined) {
    return <div className="app-loading">Loading your vault…</div>
  }
  return <NoteWorkspace {...(handle ? { vault: handle.vault } : {})} />
}
