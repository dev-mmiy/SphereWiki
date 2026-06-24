import type { OnSaveResult, SuggestionProvider } from "@spherewiki/ai"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { devAuth } from "../auth-dev"
import { useVaultWorkspace } from "./use-vault-workspace"

const LOCAL = { actor: "local", kind: "human" } as const

describe("useVaultWorkspace", () => {
  it("opens the first note with its outgoing links", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.notes.map((m) => m.title)).toEqual(["Home", "Getting Started", "Ideas"])
    expect(result.current.activeNote?.getText()).toContain("Welcome")
    expect(result.current.outgoing).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
  })

  it("computes backlinks for the active note", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Home is linked from both Getting Started and Ideas.
    expect(result.current.backlinks.map((m) => m.title).sort()).toEqual([
      "Getting Started",
      "Ideas",
    ])
  })

  it("switches notes and writes edits back to the vault", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    expect(result.current.activeNote?.getText()).toContain("AI auto-links")

    act(() => result.current.activeNote?.setText("# Ideas\n\n[[Getting Started]]\n", LOCAL))

    const gs = result.current.notes.find((m) => m.title === "Getting Started")
    act(() => {
      if (gs) result.current.select(gs.id)
    })
    expect(result.current.backlinks.map((m) => m.title)).toContain("Ideas")
  })

  it("commits and reverts the active note", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    act(() => result.current.commit("snap"))
    expect(result.current.versions).toHaveLength(1)
    const vid = result.current.versions[0]?.id

    act(() => result.current.activeNote?.setText("changed", LOCAL))
    act(() => {
      if (vid) result.current.revert(vid)
    })
    expect(result.current.activeNote?.getText()).toContain("Welcome")
  })

  it("runs the AI agent: applies edits and records an attributed version", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = devAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.applied).toBe(true)
    expect(result.current.versions.some((v) => v.origin.kind === "ai")).toBe(true)
    expect(result.current.activeNote?.getText()).toContain("tags:")
  })

  it("does nothing for a viewer (no write permission)", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const before = result.current.activeNote?.getText()
    const session = devAuth("viewer").session()
    if (session === null) throw new Error("expected a session")
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.applied).toBe(false)
    expect(res?.skippedReason).toBe("no-permission")
    expect(result.current.versions).toHaveLength(0)
    expect(result.current.activeNote?.getText()).toBe(before)
  })

  it("auto-links an unlinked mention of a sibling note", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = devAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    const gs = result.current.notes.find((m) => m.title === "Getting Started")
    act(() => {
      if (gs) result.current.select(gs.id)
    })
    act(() =>
      result.current.activeNote?.setText("# Getting Started\n\nSee Ideas for more.\n", LOCAL),
    )
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.links).toContain("Ideas")
    expect(result.current.activeNote?.getText()).toContain("[[Ideas]]")
  })

  it("persists the AI edit to the vault even if the note is switched mid-run", async () => {
    let resolveSuggest: (() => void) | null = null
    const deferred: SuggestionProvider = {
      suggest: () =>
        new Promise((resolve) => {
          resolveSuggest = () => resolve({ links: [], tags: [{ kind: "tag", tag: "aitag" }] })
        }),
    }
    const { result } = renderHook(() => useVaultWorkspace({ suggester: deferred }))
    const session = devAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    const homeId = result.current.activeId

    let run!: Promise<OnSaveResult>
    act(() => {
      run = result.current.aiOrganize(session)
    })
    // Switch away while the suggester promise is still pending.
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    await act(async () => {
      resolveSuggest?.()
      await run
    })
    // Back on Home: the AI edit reached both the vault and history despite the switch.
    act(() => result.current.select(homeId))
    expect(result.current.activeNote?.getText()).toContain("aitag")
    expect(result.current.versions.some((v) => v.origin.kind === "ai")).toBe(true)
  })
})
