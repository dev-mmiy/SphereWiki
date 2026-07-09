import { asWorkspaceId } from "@spherewiki/shared"
import { useEffect, useRef, useState } from "react"
import { createDesktopBackend, type DesktopBackend } from "./desktop-backend"
import { NoteWorkspace } from "./editor/NoteWorkspace"
import { SEED } from "./editor/use-vault-workspace"
import {
  DEFAULT_PROJECT,
  loadProjects,
  newProjectId,
  type Project,
  saveProjects,
} from "./projects/project-registry"
import { isTauri } from "./seams"
import type { Invoke } from "./vault/tauri-vault"

// The app shell (top bar + 3-pane layout) lives in NoteWorkspace. Under the native Tauri shell App
// owns the PROJECT registry (multiple isolated workspaces): it loads the registry, builds the on-disk
// backend (`.md` vault + per-project DuckDB index) for the ACTIVE project, and rebuilds it on a
// switch. Each project's vault/index is sealed to its own id, so an agent/RAG scoped to a project can
// never read another (isolation by construction). In the browser this is a no-op single-vault app.
export function App() {
  // `undefined` = still hydrating the on-disk backend (native only); `null` = browser / not-yet.
  const [backend, setBackend] = useState<DesktopBackend | null | undefined>(() =>
    isTauri() ? undefined : null,
  )
  const [projects, setProjects] = useState<readonly Project[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  // Which project `backend` was built for. `activeId` flips synchronously on a switch, but the
  // backend swap is async — so between the two, `backend` still belongs to the PREVIOUS project.
  // The render gate below waits for `backendId === activeId`, so NoteWorkspace (keyed by activeId)
  // is never mounted against a foreign project's vault/storage during the window (isolation).
  const [backendId, setBackendId] = useState<string | null>(null)
  const backendRef = useRef<DesktopBackend | null>(null)
  const invokeRef = useRef<Invoke | null>(null)

  // Load the project registry once (native only) → pick the active project.
  useEffect(() => {
    if (!isTauri()) return
    let alive = true
    import("@tauri-apps/api/core")
      .then(async ({ invoke }) => {
        invokeRef.current = invoke as Invoke
        const registry = await loadProjects(invoke as Invoke)
        if (!alive) return
        setProjects(registry.projects)
        setActiveId(registry.activeId)
      })
      // Anything in the load chain failing (the dynamic import, or a rejection loadProjects can't
      // itself swallow) must still land us on a usable app — start on the Default project rather
      // than hang forever on the loading screen. A single `.catch` also avoids the
      // `.then(onFulfilled, onRejected)` trap where onRejected can't see errors thrown in onFulfilled.
      .catch((error) => {
        console.error(
          "[tauri] project registry load failed; starting on the Default project",
          error,
        )
        if (!alive) return
        setProjects([DEFAULT_PROJECT])
        setActiveId(DEFAULT_PROJECT.id)
      })
    return () => {
      alive = false
    }
  }, [])

  // Build (or rebuild, on a switch) the backend for the ACTIVE project. Flush the one we're leaving so
  // its last edit isn't lost, and destroy a backend that arrived after we already switched away.
  useEffect(() => {
    if (!isTauri() || activeId === null) return
    let alive = true
    setBackend(undefined) // show the loading state while the new project's vault hydrates
    const leaving = backendRef.current
    createDesktopBackend(asWorkspaceId(activeId), SEED, invokeRef.current ?? undefined).then(
      (built) => {
        if (!alive) {
          void built.flush()
          return
        }
        void leaving?.flush()
        backendRef.current = built
        setBackend(built)
        setBackendId(activeId)
      },
      (error) => {
        console.error("[tauri] on-disk backend init failed; using in-webview storage", error)
        if (alive) {
          setBackend(null)
          setBackendId(activeId) // this project's fallback (in-webview) backend is ready
        }
      },
    )
    return () => {
      alive = false
    }
  }, [activeId])

  // Pending disk write-throughs are async; flush them when the window is hidden/closed.
  useEffect(() => {
    const flush = () => void backendRef.current?.flush()
    document.addEventListener("visibilitychange", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      document.removeEventListener("visibilitychange", flush)
      window.removeEventListener("beforeunload", flush)
    }
  }, [])

  const switchProject = (id: string): void => {
    if (id === activeId || invokeRef.current === null) return
    setActiveId(id)
    void saveProjects(invokeRef.current, { projects, activeId: id })
  }
  const createProject = (name: string): void => {
    if (invokeRef.current === null) return
    const project: Project = { id: newProjectId(), name: name.trim() || "Untitled project" }
    const next = [...projects, project]
    setProjects(next)
    setActiveId(project.id)
    void saveProjects(invokeRef.current, { projects: next, activeId: project.id })
  }

  // Native: hold the loading screen until the ACTIVE project's backend is the one we're about to
  // mount. `backend === undefined` covers first hydration; `backendId !== activeId` covers the
  // switch window (activeId already flipped, backend still the previous project's) — so we never
  // mount NoteWorkspace against a foreign project's vault/storage and leak/persist the wrong data.
  if (backend === undefined || (isTauri() && backendId !== activeId)) {
    return <div className="app-loading">Loading your vault…</div>
  }
  // `key={activeId}` remounts NoteWorkspace on a project switch, so all its state (notes, folders,
  // version history…) re-initializes from the new project's backend — never leaking the old project's.
  return (
    <NoteWorkspace
      key={activeId ?? "web"}
      {...(backend
        ? {
            vault: backend.vault,
            index: backend.index,
            embedder: backend.embedder,
            storage: backend.storage,
          }
        : {})}
      {...(isTauri() && activeId !== null
        ? {
            projects,
            activeProjectId: activeId,
            onSwitchProject: switchProject,
            onCreateProject: createProject,
          }
        : {})}
    />
  )
}
