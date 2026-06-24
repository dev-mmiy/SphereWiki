import { HocuspocusProvider } from "@hocuspocus/provider"
import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { createSyncServer } from "./sync-server"

async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("websocket sync server", () => {
  it("syncs two clients through the super-peer", async () => {
    const server = createSyncServer({ port: 0 })
    await server.listen()
    const url = `ws://127.0.0.1:${server.address.port}`

    // Node 25 has a global WebSocket, so the provider creates its own socket from `url`.
    const docA = new Y.Doc()
    const a = new HocuspocusProvider({ url, name: "room1", document: docA })
    const docB = new Y.Doc()
    const b = new HocuspocusProvider({ url, name: "room1", document: docB })

    try {
      await waitUntil(() => a.synced && b.synced)

      docA.getText("body").insert(0, "hello over ws")
      await waitUntil(() => docB.getText("body").toString() === "hello over ws")
      expect(docB.getText("body").toString()).toBe("hello over ws")
    } finally {
      a.destroy()
      b.destroy()
      await server.destroy()
    }
  }, 20000)
})
