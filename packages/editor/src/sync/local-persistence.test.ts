import "fake-indexeddb/auto"
import { openYjsNote } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { connectLocalPersistence } from "./local-persistence"

const LOCAL = { actor: "local", kind: "human" } as const
/** Let a fire-and-forget IndexedDB write transaction commit before we read it back. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe("connectLocalPersistence (real IndexedDB via fake-indexeddb)", () => {
  it("round-trips a synced room's content across reopen (readable offline)", async () => {
    const room = "ws/n1"
    const text = "# Persisted offline\n\n[[Ideas]]\n"

    const a = openYjsNote()
    const pa = connectLocalPersistence(a, room)
    await pa.whenLoaded
    a.setText(text, LOCAL)
    await tick()
    pa.destroy()
    a.destroy()

    // Reopening the same room loads the cached content with no server in the loop.
    const b = openYjsNote()
    const pb = connectLocalPersistence(b, room)
    await pb.whenLoaded
    expect(b.getText()).toBe(text)
    pb.destroy()
    b.destroy()
  })

  it("isolates persisted state by room name", async () => {
    const a = openYjsNote()
    const pa = connectLocalPersistence(a, "ws/roomA")
    await pa.whenLoaded
    a.setText("only in A", LOCAL)
    await tick()
    pa.destroy()
    a.destroy()

    const b = openYjsNote()
    const pb = connectLocalPersistence(b, "ws/roomB")
    await pb.whenLoaded
    expect(b.getText()).toBe("")
    pb.destroy()
    b.destroy()
  })
})
