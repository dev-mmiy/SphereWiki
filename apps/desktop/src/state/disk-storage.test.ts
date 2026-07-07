import { describe, expect, it } from "vitest"
import type { Invoke } from "../vault/tauri-vault"
import { createDiskStorage } from "./disk-storage"

/** A fake `state_load`/`state_save` backend: one JSON blob per workspace, as the Rust commands hold. */
function fakeStateBackend(): { invoke: Invoke; files: Map<string, string> } {
  const files = new Map<string, string>()
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    const a = (args ?? {}) as { workspace: string; content?: string }
    switch (cmd) {
      case "state_load":
        return files.get(a.workspace) ?? "{}"
      case "state_save":
        files.set(a.workspace, a.content as string)
        return undefined
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  }) as Invoke
  return { invoke, files }
}

describe("createDiskStorage (the .spherewiki/ durable-state sidecar)", () => {
  it("serves get/set synchronously and writes through to disk", async () => {
    const { invoke, files } = fakeStateBackend()
    const { storage, flush } = await createDiskStorage("ws-dev", invoke)

    expect(storage.getItem("spherewiki:versions:ws-dev:n1")).toBe(null) // nothing yet
    storage.setItem("spherewiki:versions:ws-dev:n1", "SNAPSHOT")
    expect(storage.getItem("spherewiki:versions:ws-dev:n1")).toBe("SNAPSHOT") // sync read
    await flush()

    // The whole blob is persisted to the workspace's state.json.
    expect(JSON.parse(files.get("ws-dev") ?? "{}")).toEqual({
      "spherewiki:versions:ws-dev:n1": "SNAPSHOT",
    })
  })

  it("rehydrates persisted state on reopen (so version history survives a reload)", async () => {
    const { invoke, files } = fakeStateBackend()
    const first = await createDiskStorage("ws-dev", invoke)
    first.storage.setItem("spherewiki:session:ws-dev", "n2")
    first.storage.setItem("spherewiki:versions:ws-dev:n2", "V")
    await first.flush()

    // A fresh adapter over the same backend = relaunching the native app.
    const second = await createDiskStorage("ws-dev", invoke)
    expect(second.storage.getItem("spherewiki:session:ws-dev")).toBe("n2")
    expect(second.storage.getItem("spherewiki:versions:ws-dev:n2")).toBe("V")
    expect(files.size).toBe(1) // one state.json for the workspace
  })

  it("degrades to empty (never throws) on a corrupt/merge-conflicted state.json", async () => {
    // A git/Dropbox merge conflict leaves conflict markers — not valid JSON. Boot must not fail.
    const invoke = (async (cmd: string) => {
      if (cmd === "state_load") return "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other"
      return undefined
    }) as Invoke
    const { storage } = await createDiskStorage("ws-dev", invoke) // must resolve, not reject
    expect(storage.getItem("anything")).toBe(null)
    // ...and a fresh write still works over the recovered-empty mirror.
    storage.setItem("k", "v")
    expect(storage.getItem("k")).toBe("v")
  })

  it("isolates workspaces — one never reads another's durable state", async () => {
    const { invoke } = fakeStateBackend()
    const a = await createDiskStorage("ws-a", invoke)
    a.storage.setItem("k", "a-value")
    await a.flush()
    const b = await createDiskStorage("ws-b", invoke)
    expect(b.storage.getItem("k")).toBe(null)
  })
})
