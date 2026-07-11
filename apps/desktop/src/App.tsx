import { NoteWorkspace, SEED } from "@spherewiki/editor"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  createDesktopBackend,
  type DesktopBackend,
  loadSharedBackends,
  type SharedBackend,
  type SharedScope,
} from "./desktop-backend"
import {
  DEFAULT_PROJECT,
  loadProjects,
  newProjectId,
  normalizeRagScope,
  type Project,
  saveProjects,
} from "./projects/project-registry"
import { isTauri } from "./seams"
import type { Invoke } from "./vault/tauri-vault"

// A stable empty scope so "no shared workspaces for the active project" keeps a constant array
// identity across renders (the hook memoizes its retriever on this).
const NO_SHARED: readonly SharedBackend[] = []

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
  // The active project's RAG scope (its included shared workspaces), loaded INDEPENDENTLY of the
  // active backend and tagged with the project it belongs to, so changing the scope updates it in
  // place (no vault reload, no remount) and a stale scope is never shown for the wrong project.
  const [sharedScope, setSharedScope] = useState<{ id: string; scope: SharedScope } | null>(null)
  const sharedRef = useRef<SharedScope | null>(null)

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

  // The active project's included `shared` workspace ids (its RAG scope). Joined into a stable string
  // so the build effect rebuilds the backend when they change (the scope changed) — but not on
  // unrelated registry edits (e.g. creating another project).
  const ragIncludesKey = (projects.find((p) => p.id === activeId)?.ragIncludes ?? []).join("|")

  // Build (or rebuild, on a switch) the ACTIVE project's backend (its own vault + index + storage).
  // Depends ONLY on activeId — NOT on the RAG scope — so changing which shared workspaces the project
  // includes never reloads its vault or remounts the workspace. Flush the one we're leaving; destroy
  // a backend that arrived after we already switched away.
  useEffect(() => {
    if (!isTauri() || activeId === null) return
    let alive = true
    setBackend(undefined) // show the loading state while the new project's vault hydrates
    const leaving = backendRef.current
    createDesktopBackend(activeId, SEED, invokeRef.current ?? undefined).then(
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

  // Load (or reload) the active project's RAG scope — its included shared workspaces — independently
  // of the active backend, so a scope change swaps them IN PLACE (no vault reload / no remount). The
  // result is tagged with `activeId`; the render only trusts it when it matches the active project.
  useEffect(() => {
    if (!isTauri() || activeId === null) return
    let alive = true
    const ragIncludes = ragIncludesKey ? ragIncludesKey.split("|") : []
    // Narrow the LIVE scope to the new set synchronously, so a REMOVED shared workspace stops being
    // searched at once — the async reload below only ADDS newly-included ones (the still-included
    // ones stay live, so adding a source never blinks the others out). Only for the same project.
    setSharedScope((prev) =>
      prev !== null && prev.id === activeId
        ? {
            id: activeId,
            scope: {
              shared: prev.scope.shared.filter((s) => ragIncludes.includes(s.id)),
              flush: prev.scope.flush,
            },
          }
        : prev,
    )
    const leaving = sharedRef.current
    loadSharedBackends(ragIncludes, invokeRef.current ?? undefined)
      .then((scope) => {
        if (!alive) {
          void scope.flush()
          return
        }
        void leaving?.flush()
        sharedRef.current = scope
        setSharedScope({ id: activeId, scope })
      })
      .catch((error) => {
        console.error("[tauri] shared RAG scope failed to load; continuing with none", error)
      })
    return () => {
      alive = false
    }
  }, [activeId, ragIncludesKey])

  // Pending disk write-throughs are async; flush them (active + shared) when the window hides/closes.
  useEffect(() => {
    const flush = () => {
      void backendRef.current?.flush()
      void sharedRef.current?.flush()
    }
    document.addEventListener("visibilitychange", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      document.removeEventListener("visibilitychange", flush)
      window.removeEventListener("beforeunload", flush)
    }
  }, [])

  // The shared backends to hand the active project — only when the loaded scope is actually for it
  // (never the previous project's, mid-switch). Memoized so identity is stable until the scope changes.
  const sharedForActive =
    sharedScope !== null && sharedScope.id === activeId ? sharedScope.scope.shared : NO_SHARED
  const sharedIndexes = useMemo(() => sharedForActive.map((s) => s.index), [sharedForActive])
  const sharedVaults = useMemo(() => sharedForActive.map((s) => s.vault), [sharedForActive])

  const switchProject = (id: string): void => {
    if (id === activeId || invokeRef.current === null) return
    setActiveId(id)
    void saveProjects(invokeRef.current, { projects, activeId: id })
  }
  const createProject = (name: string): void => {
    if (invokeRef.current === null) return
    const project: Project = {
      id: newProjectId(),
      name: name.trim() || "Untitled project",
      type: "project",
      ragIncludes: [],
    }
    const next = [...projects, project]
    setProjects(next)
    setActiveId(project.id)
    void saveProjects(invokeRef.current, { projects: next, activeId: project.id })
  }
  // Change a project's `type` (project ↔ shared) or its `ragIncludes` (which shared workspaces it
  // pulls into RAG). Re-normalized so the invariants always hold (a shared workspace includes
  // nothing; a project includes only existing shared ones), then persisted. If this touches the
  // ACTIVE project's RAG scope, App's build effect rebuilds its backend (it keys on ragIncludesKey).
  const updateProject = (
    id: string,
    patch: Partial<Pick<Project, "type" | "ragIncludes">>,
  ): void => {
    if (invokeRef.current === null || activeId === null) return
    const next = normalizeRagScope(projects.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    setProjects(next)
    void saveProjects(invokeRef.current, { projects: next, activeId })
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
            // Read-only indexes + vaults of the included shared workspaces → the retriever's RAG
            // scope. Swapped in place when the scope changes (the hook rebuilds its retriever).
            sharedIndexes,
            sharedVaults,
          }
        : {})}
      {...(isTauri() && activeId !== null
        ? {
            projects,
            activeProjectId: activeId,
            onSwitchProject: switchProject,
            onCreateProject: createProject,
            onUpdateProject: updateProject,
          }
        : {})}
    />
  )
}
