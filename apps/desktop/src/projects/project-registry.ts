import type { Invoke } from "../vault/tauri-vault"

/** A workspace's role in the org model (AD-7). `project` = an isolated per-engagement information
 * space; `shared` = org-common knowledge a project can pull into its RAG scope read-only. Kept as a
 * string union (not a boolean) so it can grow (e.g. `template`, `archive`) without a migration. */
export type ProjectType = "project" | "shared"

/** One local project (= workspace). Its `id` is the workspace id — an isolated `vaults/<id>/` with
 * its own Markdown + DuckDB index, so an agent/RAG scoped to it can never read another project. */
export interface Project {
  readonly id: string
  readonly name: string
  /** `project` (default) or `shared`. Drives RAG scope: only a `project` includes others, and only
   * `shared` workspaces may be included. */
  readonly type: ProjectType
  /** Ids of `shared` workspaces this project pulls into its RAG scope (opt-in, read-only) — the ONLY
   * cross-workspace bridge (a project can never include another `project`). Always empty for a
   * `shared` workspace (a source, not a consumer). */
  readonly ragIncludes: readonly string[]
}

const PROJECT_TYPES: readonly ProjectType[] = ["project", "shared"]

export interface ProjectsState {
  readonly projects: readonly Project[]
  /** The project whose vault/index/RAG the app is currently operating on. */
  readonly activeId: string
}

/** A project id must be a valid workspace id (Rust allow-list `[A-Za-z0-9_-]+`) so it can safely be a
 * vault-dir path component. */
const VALID_ID = /^[A-Za-z0-9_-]+$/

/** The default project keeps the id `ws-dev`, so an existing single-vault install becomes the
 * "Default" project with all its notes intact (no migration / data loss). Exported so a caller can
 * degrade to it when the registry can't even be read (see App's load fallback). */
export const DEFAULT_PROJECT: Project = {
  id: "ws-dev",
  name: "Default",
  type: "project",
  ragIncludes: [],
}

/** Validate + back-fill one raw registry entry to a full `Project`. Legacy entries (before `type` /
 * `ragIncludes` existed) lack those fields; they default to a plain `project`. Returns `null` only
 * when the base identity (a safe id + a name) is invalid — everything else is coerced to a default,
 * so this never throws. `ragIncludes` is kept but not yet cross-checked against the other projects
 * here; `loadProjects` prunes it to existing `shared` ids once the whole list is known. */
function normalizeProject(v: unknown): Project | null {
  if (typeof v !== "object" || v === null) return null
  const r = v as { id?: unknown; name?: unknown; type?: unknown; ragIncludes?: unknown }
  if (typeof r.id !== "string" || !VALID_ID.test(r.id) || typeof r.name !== "string") return null
  const type: ProjectType = PROJECT_TYPES.includes(r.type as ProjectType)
    ? (r.type as ProjectType)
    : "project"
  // A shared workspace consumes nothing; a project keeps only well-formed, non-self include ids.
  const ragIncludes =
    type === "shared" || !Array.isArray(r.ragIncludes)
      ? []
      : r.ragIncludes.filter(
          (x): x is string => typeof x === "string" && VALID_ID.test(x) && x !== r.id,
        )
  return { id: r.id, name: r.name, type, ragIncludes }
}

/** Load the project registry from `<app-data>/projects.json` (via Rust). Always returns at least the
 * Default project + a valid `activeId` — a missing/corrupt registry degrades to the default, never
 * throws (so a bad file can't brick startup). */
export async function loadProjects(invoke: Invoke): Promise<ProjectsState> {
  // The READ can also fail (an unreadable file, a non-UTF-8 / hand-corrupted registry, a
  // permissions error, app-data resolution failing) — the Rust command maps only "not found" to
  // an empty registry and rejects otherwise. Treat any read failure the same as a corrupt file:
  // degrade to the Default project. Without this, a rejected invoke would throw out of here and
  // brick startup, contradicting the "never throws" contract above.
  let raw: string
  try {
    raw = await invoke<string>("projects_load")
  } catch {
    raw = ""
  }
  let parsed: unknown = {}
  try {
    parsed = raw ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }
  const obj = (parsed !== null && typeof parsed === "object" ? parsed : {}) as {
    projects?: unknown
    activeId?: unknown
  }
  const parsedProjects = Array.isArray(obj.projects)
    ? obj.projects.map(normalizeProject).filter((p): p is Project => p !== null)
    : []
  // De-dupe by id, keep first; ensure at least the Default project exists.
  const byId = new Map<string, Project>()
  for (const p of parsedProjects) if (!byId.has(p.id)) byId.set(p.id, p)
  const deduped = byId.size > 0 ? [...byId.values()] : [DEFAULT_PROJECT]
  // A project may only include EXISTING `shared` workspaces — prune dangling / non-shared refs so
  // the registry can never encode a forbidden cross-`project` read (isolation is the only bridge is
  // an opt-in shared workspace). Done here, once every project's type is known.
  const sharedIds = new Set(deduped.filter((p) => p.type === "shared").map((p) => p.id))
  const list = deduped.map((p) =>
    p.ragIncludes.length === 0
      ? p
      : { ...p, ragIncludes: p.ragIncludes.filter((id) => sharedIds.has(id)) },
  )
  const activeId =
    typeof obj.activeId === "string" && list.some((p) => p.id === obj.activeId)
      ? obj.activeId
      : (list[0] as Project).id
  return { projects: list, activeId }
}

/** Persist the whole registry blob (via Rust, atomic). */
export async function saveProjects(invoke: Invoke, state: ProjectsState): Promise<void> {
  await invoke<void>("projects_save", { content: JSON.stringify(state) })
}

/** A fresh, valid, isolated project id for a newly-created project (`p-<uuid>`). */
export function newProjectId(): string {
  const webcrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const uuid = webcrypto?.randomUUID?.()
  if (uuid === undefined) throw new Error("crypto.randomUUID is unavailable")
  return `p-${uuid}`
}
