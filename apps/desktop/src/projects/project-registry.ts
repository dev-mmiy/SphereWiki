import type { Invoke } from "../vault/tauri-vault"

/** One local project (= workspace). Its `id` is the workspace id — an isolated `vaults/<id>/` with
 * its own Markdown + DuckDB index, so an agent/RAG scoped to it can never read another project. */
export interface Project {
  readonly id: string
  readonly name: string
}

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
export const DEFAULT_PROJECT: Project = { id: "ws-dev", name: "Default" }

function isProject(v: unknown): v is Project {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Project).id === "string" &&
    VALID_ID.test((v as Project).id) &&
    typeof (v as Project).name === "string"
  )
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
  const projects = Array.isArray(obj.projects) ? obj.projects.filter(isProject) : []
  // De-dupe by id, keep first; ensure at least the Default project exists.
  const seen = new Set<string>()
  const unique = projects.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  const list = unique.length > 0 ? unique : [DEFAULT_PROJECT]
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
