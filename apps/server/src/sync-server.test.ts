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

  describe("room authorization", () => {
    // A room-scoped grant: a token is valid only for the exact room it names.
    const authorize = ({ token, room }: { token: string | null; room: string }): boolean =>
      token === `grant:${room}`

    it("admits a client with an accepted, room-scoped token", async () => {
      const server = createSyncServer({ port: 0, authorize })
      await server.listen()
      const url = `ws://127.0.0.1:${server.address.port}`
      const provider = new HocuspocusProvider({
        url,
        name: "ws1/note",
        document: new Y.Doc(),
        token: "grant:ws1/note",
      })
      try {
        await waitUntil(() => provider.synced)
        expect(provider.synced).toBe(true)
      } finally {
        provider.destroy()
        await server.destroy()
      }
    }, 20000)

    it("rejects a client whose token the authorizer denies", async () => {
      const server = createSyncServer({ port: 0, authorize })
      await server.listen()
      const url = `ws://127.0.0.1:${server.address.port}`
      let failed = false
      const provider = new HocuspocusProvider({
        url,
        name: "ws1/note",
        document: new Y.Doc(),
        token: "nope",
        onAuthenticationFailed: () => {
          failed = true
        },
      })
      try {
        await waitUntil(() => failed)
        expect(provider.synced).toBe(false)
      } finally {
        provider.destroy()
        await server.destroy()
      }
    }, 20000)

    it("scopes the token to its room — a grant for one room can't join another", async () => {
      const server = createSyncServer({ port: 0, authorize })
      await server.listen()
      const url = `ws://127.0.0.1:${server.address.port}`
      let failed = false
      const provider = new HocuspocusProvider({
        url,
        name: "ws2/note", // joining ws2...
        document: new Y.Doc(),
        token: "grant:ws1/note", // ...with a token granted only for ws1
        onAuthenticationFailed: () => {
          failed = true
        },
      })
      try {
        await waitUntil(() => failed)
        expect(provider.synced).toBe(false)
      } finally {
        provider.destroy()
        await server.destroy()
      }
    }, 20000)
  })
})
