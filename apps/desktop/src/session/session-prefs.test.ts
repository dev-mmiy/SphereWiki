import { describe, expect, it } from "vitest"
import { createSessionPrefs } from "./session-prefs"

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

describe("createSessionPrefs", () => {
  it("reads empty defaults before anything is written", () => {
    const prefs = createSessionPrefs({ key: "s", storage: memStorage() })
    expect(prefs.read()).toEqual({})
  })

  it("persists across instances (a reload reads the last session)", () => {
    const storage = memStorage()
    const a = createSessionPrefs({ key: "s", storage })
    a.write({ activeId: "note-7" })
    a.write({ aiAutonomy: "suggest" })

    const b = createSessionPrefs({ key: "s", storage })
    expect(b.read()).toEqual({ activeId: "note-7", aiAutonomy: "suggest" })
  })

  it("merges patches rather than replacing the whole record", () => {
    const storage = memStorage()
    const prefs = createSessionPrefs({ key: "s", storage })
    prefs.write({ activeId: "n1", aiAutonomy: "auto" })
    prefs.write({ activeId: "n2" }) // autonomy must be preserved
    expect(prefs.read()).toEqual({ activeId: "n2", aiAutonomy: "auto" })
  })

  it("ignores an invalid autonomy value", () => {
    const storage = memStorage()
    storage.map.set("s", JSON.stringify({ activeId: "n1", aiAutonomy: "bogus" }))
    const prefs = createSessionPrefs({ key: "s", storage })
    expect(prefs.read()).toEqual({ activeId: "n1" })
  })

  it("ignores a malformed blob", () => {
    const storage = memStorage()
    storage.map.set("s", "{not json")
    const prefs = createSessionPrefs({ key: "s", storage })
    expect(prefs.read()).toEqual({})
  })
})
