import { describe, expect, it } from "vitest"
import type { EditOrigin } from "../crdt/types"
import { openYjsNote, yjsEngine } from "../crdt/yjs"
import { connectNoteToHub } from "./connect"
import { createMemorySyncHub } from "./memory"
import { createMemoryPersistence } from "./persistence"

const human: EditOrigin = { actor: "a", kind: "human" }

describe("sync persistence", () => {
  it("restores room state across hub restarts", () => {
    const persistence = createMemoryPersistence()

    const hub1 = createMemorySyncHub(yjsEngine, { persistence })
    const a = openYjsNote()
    const offA = connectNoteToHub(a, hub1, "room1")
    a.setText("durable content", human)
    offA()
    a.destroy()

    // Restart: a fresh hub backed by the same persistence.
    const hub2 = createMemorySyncHub(yjsEngine, { persistence })
    const b = openYjsNote()
    const offB = connectNoteToHub(b, hub2, "room1")
    expect(b.getText()).toBe("durable content")
    offB()
    b.destroy()
  })

  it("keeps persisted state isolated by room", () => {
    const persistence = createMemoryPersistence()
    const hub = createMemorySyncHub(yjsEngine, { persistence })
    const a = openYjsNote()
    const off = connectNoteToHub(a, hub, "alpha")
    a.setText("alpha only", human)
    off()
    a.destroy()

    expect(persistence.load("alpha")).not.toBeNull()
    expect(persistence.load("beta")).toBeNull()
  })
})
