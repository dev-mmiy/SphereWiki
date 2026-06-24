import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
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
})
