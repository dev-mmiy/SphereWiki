import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useNoteSession } from "./use-note-session"

const LOCAL = { actor: "local", kind: "human" } as const

describe("useNoteSession", () => {
  it("commits versions and reverts to a past one", () => {
    const { result } = renderHook(() => useNoteSession("v1"))
    expect(result.current.versions).toHaveLength(0)
    expect(result.current.note.getText()).toBe("v1")

    act(() => result.current.commit(LOCAL, "first"))
    expect(result.current.versions).toHaveLength(1)
    const vid = result.current.versions[0]?.id

    act(() => result.current.note.setText("v2", LOCAL))
    expect(result.current.note.getText()).toBe("v2")

    act(() => {
      if (vid) result.current.revert(vid, LOCAL)
    })
    expect(result.current.note.getText()).toBe("v1")
  })

  it("diffs a committed version against the current text", () => {
    const { result } = renderHook(() => useNoteSession("the quick brown fox"))
    act(() => result.current.commit(LOCAL))
    const vid = result.current.versions[0]?.id
    act(() => result.current.note.setText("the quick red fox", LOCAL))

    const chunks = vid ? result.current.diffAgainstCurrent(vid) : []
    expect(chunks).toEqual([
      { op: "eq", text: "the quick " },
      { op: "del", text: "brown" },
      { op: "ins", text: "red" },
      { op: "eq", text: " fox" },
    ])
  })
})
