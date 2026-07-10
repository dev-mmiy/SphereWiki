import { useState } from "react"
import type { Project } from "../projects/project-registry"

type UpdatePatch = Partial<Pick<Project, "type" | "ragIncludes">>

/**
 * The active-project selector (native shell only). Switching rebuilds the whole backend for the
 * chosen project's isolated vault + index; "New project" mints a fresh isolated workspace. An inline
 * input names a new project (Tauri's WKWebView has no window.prompt). A ⚙ settings popover marks the
 * active project as a `shared` knowledge workspace, or (for a plain project) picks which shared
 * workspaces it pulls into its RAG scope (read-only) — increment 2b-2.
 */
export function ProjectSwitcher({
  projects,
  activeId,
  onSwitch,
  onCreate,
  onUpdate,
}: {
  projects: readonly Project[]
  activeId: string
  onSwitch: (id: string) => void
  onCreate: (name: string) => void
  onUpdate?: (id: string, patch: UpdatePatch) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const active = projects.find((p) => p.id === activeId)
  const finishCreate = (commit: boolean): void => {
    if (commit && name.trim() !== "") onCreate(name.trim())
    setCreating(false)
    setName("")
  }
  return (
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
          <select aria-label="Project" value={activeId} onChange={(e) => onSwitch(e.target.value)}>
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
