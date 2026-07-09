import { useState } from "react"
import type { Project } from "../projects/project-registry"

/**
 * The active-project selector (native shell only). Switching rebuilds the whole backend for the
 * chosen project's isolated vault + index; "New project" mints a fresh isolated workspace. An inline
 * input names a new project (Tauri's WKWebView has no window.prompt).
 */
export function ProjectSwitcher({
  projects,
  activeId,
  onSwitch,
  onCreate,
}: {
  projects: readonly Project[]
  activeId: string
  onSwitch: (id: string) => void
  onCreate: (name: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
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
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" aria-label="New project" onClick={() => setCreating(true)}>
            ＋
          </button>
        </>
      )}
    </div>
  )
}
