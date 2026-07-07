import { useEffect, useRef, useState } from "react"
import { WORKSPACE_ID } from "./auth-local"
import { createDesktopBackend, type DesktopBackend } from "./desktop-backend"
import { NoteWorkspace } from "./editor/NoteWorkspace"
import { SEED } from "./editor/use-vault-workspace"
import { isTauri } from "./seams"

// The app shell (top bar + 3-pane layout) lives in NoteWorkspace. Under the native Tauri shell App
// first builds the on-disk backend (`.md` vault + per-workspace DuckDB vector index) and hydrates it
// before mounting the workspace — so the hook gets ready, disk-backed pieces, indistinguishable from
// the synchronous in-webview ones. In the browser this is a no-op: `backend` starts null and
// NoteWorkspace mounts immediately with its localStorage vault + in-memory index.
export function App() {
  // `undefined` = still hydrating the on-disk backend (native only); `null` = browser / not-yet.
  const [backend, setBackend] = useState<DesktopBackend | null | undefined>(() =>
    isTauri() ? undefined : null,
  )
  const backendRef = useRef<DesktopBackend | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    let alive = true
    createDesktopBackend(WORKSPACE_ID, SEED).then(
      (built) => {
        if (!alive) return
        backendRef.current = built
        setBackend(built)
      },
      (error) => {
        // If the native backend can't be built, fall back to in-webview storage rather than hang.
        console.error("[tauri] on-disk backend init failed; using in-webview storage", error)
        if (alive) setBackend(null)
      },
    )
    // Pending disk write-throughs are async; flush them when the window is hidden/closed so the last
    // edit isn't lost on a quick quit.
    const flush = () => void backendRef.current?.flush()
    document.addEventListener("visibilitychange", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      alive = false
      document.removeEventListener("visibilitychange", flush)
      window.removeEventListener("beforeunload", flush)
    }
  }, [])

  if (backend === undefined) {
    return <div className="app-loading">Loading your vault…</div>
  }
  return (
    <NoteWorkspace
      {...(backend
        ? {
            vault: backend.vault,
            index: backend.index,
            embedder: backend.embedder,
            storage: backend.storage,
          }
        : {})}
    />
  )
}
