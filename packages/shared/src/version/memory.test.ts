import { describe, expect, it } from "vitest"
import type { EditOrigin } from "../crdt/types"
import { yjsEngine } from "../crdt/yjs"
import { createMemoryVersionStore } from "./memory"

const human: EditOrigin = { actor: "alice", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }

function makeStore() {
  let t = 1000
  let n = 0
  return createMemoryVersionStore(yjsEngine, { now: () => ++t, newId: () => `v${++n}` })
}

describe("memory version store", () => {
  it("commits versions with attribution and parent links", () => {
    const store = makeStore()
    const note = yjsEngine.open()
    note.setText("first", human)
    const a = store.commit(note, { origin: human, label: "init" })
    note.setText("second", ai)
    const b = store.commit(note, { origin: ai })

    expect(a).toMatchObject({ id: "v1", origin: human, label: "init" })
    expect(a.parentId).toBeUndefined()
    expect(b).toMatchObject({ id: "v2", origin: ai, parentId: "v1" })
    expect(store.list().map((v) => v.id)).toEqual(["v1", "v2"])
  })

  it("restores a past version (revert source)", () => {
    const store = makeStore()
    const note = yjsEngine.open()
    note.setText("v1 text", human)
    const a = store.commit(note, { origin: human })
    note.setText("v2 text", ai)
    store.commit(note, { origin: ai })

    const restored = store.open(a.id)
    expect(restored.getText()).toBe("v1 text")
    restored.destroy()
  })

  it("diffs two versions", () => {
    const store = makeStore()
    const note = yjsEngine.open()
    note.setText("the quick brown fox", human)
    const a = store.commit(note, { origin: human })
    note.setText("the quick red fox", ai)
    const b = store.commit(note, { origin: ai })

    expect(store.diff(a.id, b.id)).toEqual([
      { op: "eq", text: "the quick " },
      { op: "del", text: "brown" },
      { op: "ins", text: "red" },
      { op: "eq", text: " fox" },
    ])
  })

  it("throws on an unknown version", () => {
    const store = makeStore()
    expect(() => store.open("nope")).toThrow(/unknown version/)
  })
})
