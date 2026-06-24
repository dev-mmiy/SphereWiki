import { describe, expect, it } from "vitest"
import type { EditOrigin } from "../crdt/types"
import { openYjsNote, yjsEngine } from "../crdt/yjs"
import { connectNoteToHub } from "./connect"
import { createMemorySyncHub } from "./memory"

const human: EditOrigin = { actor: "a", kind: "human" }

describe("memory sync hub", () => {
  it("converges two clients through the super-peer", () => {
    const hub = createMemorySyncHub(yjsEngine)
    const a = openYjsNote()
    a.setText("hello", human)
    const b = openYjsNote()

    const offA = connectNoteToHub(a, hub, "room1")
    const offB = connectNoteToHub(b, hub, "room1")
    expect(b.getText()).toBe("hello") // b received a's content via the hub

    b.setText("hello world", human)
    expect(a.getText()).toBe("hello world") // a received b's edit via the hub

    offA()
    offB()
    a.destroy()
    b.destroy()
  })

  it("keeps an authoritative, server-readable replica", () => {
    const hub = createMemorySyncHub(yjsEngine)
    const a = openYjsNote()
    const off = connectNoteToHub(a, hub, "r")
    a.setText("the server can read this", human)

    const peek = hub.connect("r", () => {})
    const replica = yjsEngine.open(peek.snapshot())
    expect(replica.getText()).toBe("the server can read this")

    peek.disconnect()
    off()
    a.destroy()
    replica.destroy()
  })

  it("does not echo: a disconnected client stops receiving updates", () => {
    const hub = createMemorySyncHub(yjsEngine)
    const a = openYjsNote()
    const b = openYjsNote()
    const offA = connectNoteToHub(a, hub, "x")
    const offB = connectNoteToHub(b, hub, "x")

    offB() // b leaves
    a.setText("after b left", human)
    expect(b.getText()).toBe("") // b no longer receives updates

    offA()
    a.destroy()
    b.destroy()
  })
})
