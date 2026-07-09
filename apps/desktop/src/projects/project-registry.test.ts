import { describe, expect, it } from "vitest"
import type { Invoke } from "../vault/tauri-vault"
import { DEFAULT_PROJECT, loadProjects, newProjectId, saveProjects } from "./project-registry"

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
    expect(s.projects).toEqual([DEFAULT_PROJECT])
    expect(s.projects[0]).toMatchObject({ type: "project", ragIncludes: [] })
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
    expect(s.projects).toEqual([DEFAULT_PROJECT])
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

  it("back-fills legacy entries (no type / ragIncludes) to a plain 'project'", async () => {
    // projects.json written before type/ragIncludes existed must load without a migration.
    const raw = JSON.stringify({
      projects: [{ id: "ws-dev", name: "Default" }],
      activeId: "ws-dev",
    })
    const s = await loadProjects(invokeWith(raw))
    expect(s.projects[0]).toEqual({
      id: "ws-dev",
      name: "Default",
      type: "project",
      ragIncludes: [],
    })
  })

  it("coerces an invalid type to 'project' and forces a shared workspace's ragIncludes empty", async () => {
    const raw = JSON.stringify({
      projects: [
        { id: "ws-dev", name: "Default", type: "project", ragIncludes: ["shared-1"] },
        { id: "shared-1", name: "Common", type: "shared", ragIncludes: ["ws-dev"] }, // shared ⇒ []
        { id: "p-2", name: "Weird", type: "bogus", ragIncludes: [] }, // bad type ⇒ project
      ],
      activeId: "ws-dev",
    })
    const s = await loadProjects(invokeWith(raw))
    const byId = Object.fromEntries(s.projects.map((p) => [p.id, p]))
    expect(byId["shared-1"]).toMatchObject({ type: "shared", ragIncludes: [] })
    expect(byId["p-2"]).toMatchObject({ type: "project" })
    expect(byId["ws-dev"]?.ragIncludes).toEqual(["shared-1"]) // includes an existing shared ws
  })

  it("prunes ragIncludes to EXISTING shared workspaces (drops self / non-shared / dangling refs)", async () => {
    const raw = JSON.stringify({
      projects: [
        // includes: itself (self), another project (non-shared), a missing id (dangling), one real shared
        { id: "p-1", name: "A", type: "project", ragIncludes: ["p-1", "p-2", "ghost", "shared-1"] },
        { id: "p-2", name: "B", type: "project", ragIncludes: [] },
        { id: "shared-1", name: "Common", type: "shared", ragIncludes: [] },
      ],
      activeId: "p-1",
    })
    const s = await loadProjects(invokeWith(raw))
    const p1 = s.projects.find((p) => p.id === "p-1")
    expect(p1?.ragIncludes).toEqual(["shared-1"]) // only the real shared workspace survives
  })

  it("saveProjects serializes the whole registry through projects_save (incl. type + ragIncludes)", async () => {
    let saved = ""
    const state = {
      projects: [
        { id: "ws-dev", name: "Default", type: "project" as const, ragIncludes: ["shared-1"] },
        { id: "shared-1", name: "Common", type: "shared" as const, ragIncludes: [] },
      ],
      activeId: "ws-dev",
    }
    await saveProjects(
      invokeWith("{}", (c) => {
        saved = c
      }),
      state,
    )
    expect(JSON.parse(saved)).toEqual(state)
  })
})
