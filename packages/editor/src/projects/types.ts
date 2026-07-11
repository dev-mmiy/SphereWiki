// The project (= workspace) shape the editor UI needs — the ProjectSwitcher renders projects and
// reports type/include edits. The REGISTRY persistence (loading/saving projects.json via the Tauri
// `invoke` bridge, normalization) stays in the app that owns the platform, and imports these types.

/** A workspace's role in the org model (AD-7). `project` = an isolated per-engagement information
 * space; `shared` = org-common knowledge a project can pull into its RAG scope read-only. A string
 * union (not a boolean) so it can grow (e.g. `template`, `archive`) without a migration. */
export type ProjectType = "project" | "shared"

/** One project (= workspace): an isolated `vaults/<id>/` with its own Markdown + index, so an
 * agent/RAG scoped to it can never read another. */
export interface Project {
  readonly id: string
  readonly name: string
  /** `project` (default) or `shared`. Drives RAG scope: only a `project` includes others, and only
   * `shared` workspaces may be included. */
  readonly type: ProjectType
  /** Ids of `shared` workspaces this project pulls into its RAG scope (opt-in, read-only) — the ONLY
   * cross-workspace bridge (a project can never include another `project`). Empty for a `shared`
   * workspace (a source, not a consumer). */
  readonly ragIncludes: readonly string[]
}
