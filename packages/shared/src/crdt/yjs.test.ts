import { describe, expect, it } from "vitest"
import type { CrdtTextEvent, EditOrigin } from "./types"
import { yjsEngine } from "./yjs"

const human: EditOrigin = { actor: "alice", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }

describe("yjsEngine", () => {
  it("sets and reads text", () => {
    const note = yjsEngine.open()
    note.setText("# Hello", human)
    expect(note.getText()).toBe("# Hello")
    note.destroy()
  })

  it("emits one tagged, local event per edit", () => {
    const note = yjsEngine.open()
    note.setText("the quick brown fox", human)
    const events: CrdtTextEvent[] = []
    const off = note.subscribe((e) => events.push(e))
    note.setText("the quick red fox", ai)
    off()
    expect(note.getText()).toBe("the quick red fox")
    expect(events).toHaveLength(1)
    expect(events[0]?.origin).toEqual(ai)
    expect(events[0]?.remote).toBe(false)
    note.destroy()
  })

  it("merges concurrent edits at different positions with no loss", () => {
    const a = yjsEngine.open()
    a.setText("hello world", human)
    const b = yjsEngine.open(a.encodeState())
    a.setText("HELLO world", human) // edit the start
    b.setText("hello WORLD", { actor: "bob", kind: "human" }) // edit the end
    a.applyUpdate(b.encodeState())
    b.applyUpdate(a.encodeState())
    expect(a.getText()).toBe(b.getText()) // CRDT convergence
    expect(a.getText()).toContain("HELLO")
    expect(a.getText()).toContain("WORLD")
    a.destroy()
    b.destroy()
  })

  it("round-trips through encodeState", () => {
    const note = yjsEngine.open()
    note.setText("payload", human)
    const restored = yjsEngine.open(note.encodeState())
    expect(restored.getText()).toBe("payload")
    note.destroy()
    restored.destroy()
  })

  it("flags merged remote updates as remote", () => {
    const a = yjsEngine.open()
    a.setText("base", human)
    const b = yjsEngine.open(a.encodeState())
    const remoteFlags: boolean[] = []
    const off = b.subscribe((e) => remoteFlags.push(e.remote))
    a.setText("base + more", human)
    b.applyUpdate(a.encodeState())
    off()
    expect(remoteFlags.at(-1)).toBe(true)
    a.destroy()
    b.destroy()
  })

  describe("snapshot compaction", () => {
    it("encodes only the version's visible content, not the live doc's retained tombstones", () => {
      const note = yjsEngine.open()
      note.setText("x".repeat(5000), human) // type a lot...
      note.setText("hello", human) // ...then delete almost all of it
      // The live editing doc runs gc:false (AD-4 history substrate), so its sync
      // encoding still carries every deleted character — unbounded with churn.
      expect(note.encodeState().byteLength).toBeGreaterThan(4000)
      // A version snapshot must NOT inherit that bloat: it carries only the visible
      // content at commit time, so per-version history storage stays bounded.
      expect(note.snapshot().byteLength).toBeLessThan(200)
      note.destroy()
    })

    it("stays self-contained: reconstructs the exact text from a churn-heavy history", () => {
      const note = yjsEngine.open()
      note.setText("draft one two three four five", human)
      note.setText("final", ai) // heavy delete + small insert
      const restored = yjsEngine.fromSnapshot(note.snapshot())
      expect(restored.getText()).toBe("final")
      restored.destroy()
      note.destroy()
    })

    it("reconstructs exactly after a merged concurrent history with deletes", () => {
      // Compaction must survive tombstones from MORE THAN ONE client id: a snapshot of a
      // doc that merged a peer's edits and then deleted across the merge must still restore.
      const a = yjsEngine.open()
      a.setText("hello world", human)
      const b = yjsEngine.open(a.encodeState())
      a.setText("AAA hello world", human) // edit the start
      b.setText("hello world BBB", { actor: "bob", kind: "human" }) // edit the end
      a.applyUpdate(b.encodeState()) // merge: two client ids now present
      a.setText("hello world BBB", ai) // delete "AAA " back out (cross-client tombstone)
      const restored = yjsEngine.fromSnapshot(a.snapshot())
      expect(restored.getText()).toBe("hello world BBB")
      restored.destroy()
      a.destroy()
      b.destroy()
    })
  })
})
