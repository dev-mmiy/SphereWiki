import { describe, expect, it } from "vitest"
import type { Invoke } from "../vault/tauri-vault"
import { loadProjects, newProjectId, saveProjects } from "./project-registry"

const invokeWith = (loaded: string, onSave?: (content: string) => void): Invoke =>
  (async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "projects_load") return loaded
    if (cmd === "projects_save") {
      onSave?.((args as { content: string }).content)
      return undefined
    }
    throw new Error(`unknown command: ${cmd}`)
  }) as Invoke

describe("project-registry", () => {
  it("defaults to the ws-dev 'Default' project when empty (preserves an existing single vault)", async () => {
    const s = await loadProjects(invokeWith("{}"))
    expect(s.projects).toEqual([{ id: "ws-dev", name: "Default" }])
    expect(s.activeId).toBe("ws-dev")
  })

  it("degrades a corrupt/foreign registry to a valid default — never throws", async () => {
    for (const raw of ["not json", "[]", '{"projects":"x"}', '{"projects":null}']) {
      const s = await loadProjects(invokeWith(raw))
      expect(s.projects.length).toBeGreaterThan(0)
      expect(s.projects.some((p) => p.id === s.activeId)).toBe(true) // activeId always valid
    }
  })

  it("degrades to the default when the registry READ itself fails — never throws (can't brick startup)", async () => {
    // Rust rejects projects_load for any non-"not found" error (unreadable / non-UTF-8 / permissions).
    const rejecting: Invoke = (async (cmd: string) => {
      if (cmd === "projects_load")
        throw new Error("InvalidData: stream did not contain valid UTF-8")
      throw new Error(`unknown command: ${cmd}`)
    }) as Invoke
    const s = await loadProjects(rejecting)
    expect(s.projects).toEqual([{ id: "ws-dev", name: "Default" }])
    expect(s.activeId).toBe("ws-dev")
  })

  it("loads valid projects, dedupes by id, and clamps a stale activeId to an existing one", async () => {
    const raw = JSON.stringify({
      projects: [
        { id: "ws-dev", name: "A" },
        { id: "p-1", name: "B" },
        { id: "ws-dev", name: "dup" },
      ],
      activeId: "ghost",
    })
    const s = await loadProjects(invokeWith(raw))
    expect(s.projects.map((p) => p.id)).toEqual(["ws-dev", "p-1"]) // duplicate id dropped
    expect(s.activeId).toBe("ws-dev") // unknown activeId falls back to the first project
  })

  it("rejects an invalid project id — a project id must be a safe workspace-dir component", async () => {
    const raw = JSON.stringify({
      projects: [
        { id: "../etc", name: "bad" },
        { id: "ok_1", name: "ok" },
      ],
      activeId: "ok_1",
    })
    const s = await loadProjects(invokeWith(raw))
    expect(s.projects.map((p) => p.id)).toEqual(["ok_1"]) // "../etc" rejected (isolation guard)
  })

  it("newProjectId is a fresh, valid workspace id (p-<uuid>)", () => {
    expect(newProjectId()).toMatch(/^p-[A-Za-z0-9-]+$/)
    expect(newProjectId()).not.toBe(newProjectId()) // unique
  })

  it("saveProjects serializes the whole registry through projects_save", async () => {
    let saved = ""
    await saveProjects(
      invokeWith("{}", (c) => {
        saved = c
      }),
      { projects: [{ id: "ws-dev", name: "Default" }], activeId: "ws-dev" },
    )
    expect(JSON.parse(saved)).toEqual({
      projects: [{ id: "ws-dev", name: "Default" }],
      activeId: "ws-dev",
    })
  })
})
