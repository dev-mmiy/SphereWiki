import { useState } from "react"
import type { Project } from "../projects/types"

type UpdatePatch = Partial<Pick<Project, "type" | "ragIncludes">>

/**
 * The ACTIVE-PROJECT header for the left pane (native shell only). It sits at the top of the sidebar
 * and makes the pane *about* the active project — the one isolated workspace (`vaults/<id>/`) that
 * everything below it (Search · Notes · Trash) belongs to — so a project switch (which rebuilds the
 * whole backend) is also *visible* here: the active project's name, its `type` chip (PROJECT /
 * SHARED), its note count, and its RAG "Includes" chips (the `shared` workspaces it reads). The first
 * four switchers live in the control row: switching rebuilds the backend for the chosen project's
 * isolated vault + index; "New project" mints a fresh isolated workspace. An inline input names a new
 * project (Tauri's WKWebView has no `window.prompt`). A ⚙ settings popover marks the active project a
 * `shared` knowledge workspace, or (for a plain project) picks which shared workspaces it pulls into
 * its RAG scope (read-only) — increment 2b-2.
 */
export function ProjectSwitcher({
  projects,
  activeId,
  onSwitch,
  onCreate,
  noteCount = 0,
  onUpdate,
}: {
  projects: readonly Project[]
  activeId: string
  onSwitch: (id: string) => void
  onCreate: (name: string) => void
  /** The active project's note count — shown in the scope line so a switch is visible. */
  noteCount?: number
  onUpdate?: (id: string, patch: UpdatePatch) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const active = projects.find((p) => p.id === activeId)
  // The shared workspaces the active project reads (its RAG scope) — the only cross-workspace bridge
  // (AD-7), surfaced so a user can SEE the scope a normal "project" pulls in.
  const included = active?.ragIncludes.length
    ? projects.filter((p) => active.ragIncludes.includes(p.id))
    : []
  const finishCreate = (commit: boolean): void => {
    if (commit && name.trim() !== "") onCreate(name.trim())
    setCreating(false)
    setName("")
  }
  return (
    <section className="project-header" aria-label="Active project">
      <div className="project-switcher">
        {creating ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit click, so it should take focus at once.
            autoFocus
            aria-label="New project name"
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishCreate(true)
              else if (e.key === "Escape") finishCreate(false)
            }}
            onBlur={() => finishCreate(false)}
          />
        ) : (
          <>
            <span aria-hidden="true">📦</span>
            <select
              aria-label="Project"
              value={activeId}
              onChange={(e) => onSwitch(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.type === "shared" ? `${p.name} (shared)` : p.name}
                </option>
              ))}
            </select>
            <button type="button" aria-label="New project" onClick={() => setCreating(true)}>
              ＋
            </button>
            {onUpdate !== undefined && active !== undefined && (
              <button
                type="button"
                aria-label="Project settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((o) => !o)}
              >
                ⚙
              </button>
            )}
          </>
        )}
        {onUpdate !== undefined && active !== undefined && settingsOpen && (
          <ProjectSettings project={active} projects={projects} onUpdate={onUpdate} />
        )}
      </div>
      {active !== undefined && (
        <div className="project-meta">
          <span
            className={
              active.type === "shared" ? "project-chip project-chip--shared" : "project-chip"
            }
          >
            {active.type}
          </span>
          <span className="project-scope">
            {noteCount} {noteCount === 1 ? "note" : "notes"}
            {included.length > 0 ? ` · ${included.length} shared` : ""}
          </span>
        </div>
      )}
      {included.length > 0 && (
        <section className="project-includes" aria-label="Included shared knowledge">
          <h3>Includes · read-only</h3>
          <ul>
            {included.map((p) => (
              <li key={p.id} className="project-include-chip">
                {p.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

/** The active project's RAG-scope settings: mark it `shared`, or (as a project) opt into shared sources. */
function ProjectSettings({
  project,
  projects,
  onUpdate,
}: {
  project: Project
  projects: readonly Project[]
  onUpdate: (id: string, patch: UpdatePatch) => void
}) {
  const isShared = project.type === "shared"
  const sharedWorkspaces = projects.filter((p) => p.type === "shared" && p.id !== project.id)
  return (
    <section className="project-settings" aria-label="Project settings">
      <label className="project-settings-row">
        <input
          type="checkbox"
          checked={isShared}
          onChange={(e) => onUpdate(project.id, { type: e.target.checked ? "shared" : "project" })}
        />
        Shared knowledge workspace
      </label>
      {isShared ? (
        <p className="hint">
          Other projects can include this workspace's notes in their RAG scope (read-only).
        </p>
      ) : sharedWorkspaces.length === 0 ? (
        <p className="hint">Mark another project as “shared” to include its knowledge here.</p>
      ) : (
        <fieldset className="project-settings-includes">
          <legend>Include shared knowledge</legend>
          {sharedWorkspaces.map((s) => {
            const included = project.ragIncludes.includes(s.id)
            return (
              <label key={s.id} className="project-settings-row">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() =>
                    onUpdate(project.id, {
                      ragIncludes: included
                        ? project.ragIncludes.filter((x) => x !== s.id)
                        : [...project.ragIncludes, s.id],
                    })
                  }
                />
                {s.name}
              </label>
            )
          })}
        </fieldset>
      )}
    </section>
  )
}
