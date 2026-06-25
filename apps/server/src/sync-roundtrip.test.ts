import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HocuspocusProvider } from "@hocuspocus/provider"
import { openYjsNote } from "@spherewiki/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createFilePersistence } from "./file-persistence"
import { createSyncServer } from "./sync-server"

async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("super-peer sync + durable persistence", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spherewiki-sync-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("syncs two notes through the super-peer and persists across a restart", async () => {
    const room = "ws-dev/n1"
    const persistence = createFilePersistence(dir)
    const server = createSyncServer({ port: 0, persistence, debounce: 50 })
    await server.listen()
    const url = `ws://127.0.0.1:${server.address.port}`

    // Two clients bind their note docs to the same room — exactly what the desktop does.
    const a = openYjsNote()
    const pa = new HocuspocusProvider({ url, name: room, document: a.ydoc })
    const b = openYjsNote()
    const pb = new HocuspocusProvider({ url, name: room, document: b.ydoc })

    try {
      await waitUntil(() => pa.synced && pb.synced)
      a.setText("synced over the super-peer", { actor: "a", kind: "human" })
      await waitUntil(() => b.getText() === "synced over the super-peer")
      expect(b.getText()).toBe("synced over the super-peer")
      // The super-peer durably persisted the room's state to disk — decode and verify content.
      await waitUntil(() => persistence.load(room) !== null)
      const stored = openYjsNote(persistence.load(room) ?? new Uint8Array())
      try {
        expect(stored.getText()).toBe("synced over the super-peer")
      } finally {
        stored.destroy()
      }
    } finally {
      pa.destroy()
      pb.destroy()
      await server.destroy()
    }

    // Restart: a brand-new server over the same data dir; a fresh client gets the state.
    const server2 = createSyncServer({
      port: 0,
      persistence: createFilePersistence(dir),
      debounce: 50,
    })
    await server2.listen()
    const url2 = `ws://127.0.0.1:${server2.address.port}`
    const c = openYjsNote()
    const pc = new HocuspocusProvider({ url: url2, name: room, document: c.ydoc })

    try {
      await waitUntil(() => c.getText() === "synced over the super-peer")
      expect(c.getText()).toBe("synced over the super-peer")
    } finally {
      pc.destroy()
      await server2.destroy()
    }
  }, 30000)

  it("converges concurrent edits without losing either", async () => {
    const room = "ws-dev/n2"
    const server = createSyncServer({
      port: 0,
      persistence: createFilePersistence(dir),
      debounce: 50,
    })
    await server.listen()
    const url = `ws://127.0.0.1:${server.address.port}`
    const a = openYjsNote()
    const pa = new HocuspocusProvider({ url, name: room, document: a.ydoc })
    const b = openYjsNote()
    const pb = new HocuspocusProvider({ url, name: room, document: b.ydoc })

    try {
      await waitUntil(() => pa.synced && pb.synced)
      a.setText("AAA", { actor: "a", kind: "human" })
      await waitUntil(() => b.getText() === "AAA")
      // Concurrent edits at different offsets: a appends, b prepends.
      a.setText("AAA-end", { actor: "a", kind: "human" })
      b.setText("start-AAA", { actor: "b", kind: "human" })
      await waitUntil(
        () =>
          a.getText() === b.getText() &&
          a.getText().includes("start") &&
          a.getText().includes("end"),
      )
      expect(a.getText()).toBe(b.getText())
      expect(a.getText()).toContain("start")
      expect(a.getText()).toContain("end")
    } finally {
      pa.destroy()
      pb.destroy()
      await server.destroy()
    }
  }, 30000)
})
