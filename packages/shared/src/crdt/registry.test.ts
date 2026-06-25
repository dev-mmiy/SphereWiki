import { describe, expect, it } from "vitest"
import type * as Y from "yjs"
import type { CrdtRegistryEvent, EditOrigin } from "./types"
import { openYjsRegistry } from "./yjs"

const alice: EditOrigin = { actor: "alice", kind: "human" }
const bob: EditOrigin = { actor: "bob", kind: "human" }
const ai: EditOrigin = { actor: "ai-agent", kind: "ai" }

describe("openYjsRegistry", () => {
  it("sets, reads, and lists entries", () => {
    const reg = openYjsRegistry()
    reg.set("n1", { title: "Home" }, alice)
    reg.set("n2", { title: "Ideas" }, alice)
    expect(reg.get("n1")).toEqual({ title: "Home" })
    expect([...reg.entries().entries()]).toEqual([
      ["n1", { title: "Home" }],
      ["n2", { title: "Ideas" }],
    ])
    reg.destroy()
  })

  it("returns undefined for an unknown id", () => {
    const reg = openYjsRegistry()
    expect(reg.get("missing")).toBeUndefined()
    reg.destroy()
  })

  it("renames in place (last write per id wins) and removes entries", () => {
    const reg = openYjsRegistry()
    reg.set("n1", { title: "Home" }, alice)
    reg.set("n1", { title: "Welcome" }, alice) // rename same id
    expect(reg.get("n1")).toEqual({ title: "Welcome" })
    reg.delete("n1", alice)
    expect(reg.get("n1")).toBeUndefined()
    expect(reg.entries().size).toBe(0)
    reg.destroy()
  })

  it("snapshot from entries() cannot mutate registry state", () => {
    const reg = openYjsRegistry()
    reg.set("n1", { title: "Home" }, alice)
    const snapshot = reg.entries()
    const entry = snapshot.get("n1")
    if (entry === undefined) throw new Error("expected entry")
    ;(entry as { title: string }).title = "Hacked"
    expect(reg.get("n1")).toEqual({ title: "Home" }) // unaffected
    reg.destroy()
  })

  it("converges two replicas: a create on one peer appears on the other", () => {
    const a = openYjsRegistry()
    a.set("n1", { title: "Home" }, alice)
    const b = openYjsRegistry(a.encodeState())
    a.set("n2", { title: "Ideas" }, alice)
    b.applyUpdate(a.encodeState())
    expect([...b.entries().keys()].sort()).toEqual(["n1", "n2"])
    expect(b.get("n2")).toEqual({ title: "Ideas" })
    a.destroy()
    b.destroy()
  })

  it("merges concurrent disjoint creates with no lost edit (CRDT convergence)", () => {
    const a = openYjsRegistry()
    a.set("n1", { title: "Home" }, alice)
    const b = openYjsRegistry(a.encodeState())
    a.set("n2", { title: "From A" }, alice) // concurrent...
    b.set("n3", { title: "From B" }, bob) // ...on the other replica
    a.applyUpdate(b.encodeState())
    b.applyUpdate(a.encodeState())
    expect([...a.entries().keys()].sort()).toEqual(["n1", "n2", "n3"])
    expect(a.entries()).toEqual(b.entries()) // identical converged state
    a.destroy()
    b.destroy()
  })

  it("is idempotent: applying the same update twice yields identical state", () => {
    const a = openYjsRegistry()
    a.set("n1", { title: "Home" }, alice)
    const update = a.encodeState()
    const b = openYjsRegistry()
    b.applyUpdate(update)
    const after1 = [...b.entries()]
    b.applyUpdate(update) // re-apply
    expect([...b.entries()]).toEqual(after1)
    a.destroy()
    b.destroy()
  })

  it("notifies subscribers with the full snapshot and origin attribution", () => {
    const reg = openYjsRegistry()
    const events: CrdtRegistryEvent[] = []
    const off = reg.subscribe((e) => events.push(e))
    reg.set("n1", { title: "Home" }, ai)
    off()
    reg.set("n2", { title: "After unsubscribe" }, alice)
    expect(events).toHaveLength(1)
    expect(events[0]?.origin).toEqual(ai)
    expect(events[0]?.remote).toBe(false)
    expect(events[0]?.entries.get("n1")).toEqual({ title: "Home" })
    reg.destroy()
  })

  it("flags merged remote updates as remote", () => {
    const a = openYjsRegistry()
    const b = openYjsRegistry()
    const remoteFlags: boolean[] = []
    const off = b.subscribe((e) => remoteFlags.push(e.remote))
    a.set("n1", { title: "Home" }, alice)
    b.applyUpdate(a.encodeState())
    off()
    expect(remoteFlags.at(-1)).toBe(true)
    a.destroy()
    b.destroy()
  })

  it("drops malformed remote entries instead of surfacing title=undefined", () => {
    // Model an untrusted peer writing non-{title} values straight into the registry map
    // (Yjs does no runtime validation), then merge it into a well-behaved replica.
    const peer = openYjsRegistry()
    peer.set("good", { title: "Home" }, alice)
    const rawMap = peer.ydoc.getMap("registry") as Y.Map<unknown>
    rawMap.set("bad-primitive", 42)
    rawMap.set("bad-shape", { notTitle: "x" })

    const replica = openYjsRegistry(peer.encodeState())
    expect(replica.get("good")).toEqual({ title: "Home" })
    expect(replica.get("bad-primitive")).toBeUndefined()
    expect(replica.get("bad-shape")).toBeUndefined()
    expect([...replica.entries().keys()]).toEqual(["good"]) // malformed ids dropped
    peer.destroy()
    replica.destroy()
  })

  it("carries a soft-delete tombstone that converges and is revertible", () => {
    const a = openYjsRegistry()
    a.set("n1", { title: "Home" }, alice)
    const b = openYjsRegistry(a.encodeState())
    // Delete on A, then merge into B.
    a.set("n1", { title: "Home", deleted: true }, alice)
    b.applyUpdate(a.encodeState())
    expect(b.get("n1")).toEqual({ title: "Home", deleted: true })
    // Restore on B, then merge back into A — both converge to not-deleted.
    b.set("n1", { title: "Home", deleted: false }, bob)
    a.applyUpdate(b.encodeState())
    expect(a.get("n1")).toEqual({ title: "Home" }) // deleted omitted when false
    expect(a.get("n1")?.deleted).toBeUndefined()
    a.destroy()
    b.destroy()
  })

  it("coerces a non-boolean tombstone from a remote peer to a safe shape", () => {
    const peer = openYjsRegistry()
    peer.set("n1", { title: "Home" }, alice)
    const rawMap = peer.ydoc.getMap("registry") as Y.Map<unknown>
    rawMap.set("n2", { title: "Truthy", deleted: "yes" }) // not a real boolean
    const replica = openYjsRegistry(peer.encodeState())
    // Only a strict `true` tombstones; a truthy non-boolean is treated as not-deleted.
    expect(replica.get("n2")).toEqual({ title: "Truthy" })
    expect(replica.get("n2")?.deleted).toBeUndefined()
    peer.destroy()
    replica.destroy()
  })

  it("round-trips through encodeState (rebuildable from a prior update)", () => {
    const reg = openYjsRegistry()
    reg.set("n1", { title: "Home" }, alice)
    reg.set("n2", { title: "Ideas" }, alice)
    const restored = openYjsRegistry(reg.encodeState())
    expect(restored.entries()).toEqual(reg.entries())
    reg.destroy()
    restored.destroy()
  })
})
