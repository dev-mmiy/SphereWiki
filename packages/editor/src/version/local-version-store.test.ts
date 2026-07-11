import { type EditOrigin, yjsEngine } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { createLocalStorageVersionStore } from "./local-version-store"

const human: EditOrigin = { actor: "you", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }

function memStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      map.set(k, v)
    },
  }
}

describe("createLocalStorageVersionStore", () => {
  it("round-trips a note's history across a reopen (revert points survive a reload)", () => {
    const storage = memStorage()
    const key = "versions:ws/note-1"

    const first = createLocalStorageVersionStore(yjsEngine, { storage, key })
    const note = yjsEngine.open()
    note.setText("v1 body", human)
    const a = first.commit(note, { origin: human, label: "first" })
    note.setText("v2 body", ai)
    first.commit(note, { origin: ai })

    // Reopen the same key in a fresh store — the history loads with no server in the loop.
    const second = createLocalStorageVersionStore(yjsEngine, { storage, key })
    expect(second.list().map((v) => v.id)).toEqual(["v1", "v2"])
    const v = second.list()[0]
    expect(v?.origin).toEqual(human)
    expect(v?.label).toBe("first")
    // The snapshot is a working restore point after the reload.
    const restored = second.open(a.id)
    expect(restored.getText()).toBe("v1 body")
    restored.destroy()
    note.destroy()
  })

  it("resumes the id counter after a reopen so a new commit doesn't collide", () => {
    const storage = memStorage()
    const key = "versions:ws/note-2"
    const first = createLocalStorageVersionStore(yjsEngine, { storage, key })
    const note = yjsEngine.open()
    note.setText("one", human)
    first.commit(note, { origin: human })

    const second = createLocalStorageVersionStore(yjsEngine, { storage, key })
    note.setText("two", human)
    const b = second.commit(note, { origin: human })
    expect(b.id).toBe("v2") // not "v1" — the counter resumed past the loaded version
    expect(second.list().map((v) => v.id)).toEqual(["v1", "v2"])
    note.destroy()
  })

  it("isolates history by key", () => {
    const storage = memStorage()
    const a = createLocalStorageVersionStore(yjsEngine, { storage, key: "versions:ws/a" })
    const note = yjsEngine.open()
    note.setText("only in a", human)
    a.commit(note, { origin: human })

    const b = createLocalStorageVersionStore(yjsEngine, { storage, key: "versions:ws/b" })
    expect(b.list()).toEqual([])
    note.destroy()
  })

  it("ignores a malformed persisted blob (starts clean, then persists)", () => {
    const storage = memStorage()
    const key = "versions:ws/note-3"
    storage.map.set(key, "{not json")
    const store = createLocalStorageVersionStore(yjsEngine, { storage, key })
    expect(store.list()).toEqual([])

    const note = yjsEngine.open()
    note.setText("fresh", human)
    store.commit(note, { origin: human })
    // A fresh store sees the recovered, now-valid history.
    const reopened = createLocalStorageVersionStore(yjsEngine, { storage, key })
    expect(reopened.list().map((v) => v.id)).toEqual(["v1"])
    note.destroy()
  })
})
