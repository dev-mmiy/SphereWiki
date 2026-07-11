import { HocuspocusProvider } from "@hocuspocus/provider"
import { issueWorkspaceToken } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { createSyncServer, createWorkspaceTokenAuthorizer } from "./sync-server"

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

  describe("workspace-token authorizer scope (P3)", () => {
    const SECRET = "authz-secret"

    it("admits only the token's own workspace rooms, shaped `<ws>/<one segment>`", async () => {
      const authz = createWorkspaceTokenAuthorizer(SECRET)
      const tok = await issueWorkspaceToken("ws1", SECRET)
      expect(await authz({ token: tok, room: "ws1/note-1" })).toBe(true)
      expect(await authz({ token: tok, room: "ws1/__registry__" })).toBe(true)
      // A deeper path is rejected — a `ws1` token must not reach a `ws1/secret` workspace's rooms.
      expect(await authz({ token: tok, room: "ws1/secret/note-1" })).toBe(false)
      expect(await authz({ token: tok, room: "ws2/note-1" })).toBe(false) // wrong workspace
      expect(await authz({ token: tok, room: "ws1" })).toBe(false) // bare workspace, not a real room
      expect(await authz({ token: tok, room: "ws1/" })).toBe(false) // empty note segment
      expect(await authz({ token: null, room: "ws1/note-1" })).toBe(false) // no token
      expect(await authz({ token: "garbage.sig", room: "ws1/note-1" })).toBe(false) // bad token
    })
  })

  describe("workspace-token authorizer (P3, real HMAC tokens over a socket)", () => {
    const SECRET = "server-side-sync-secret"

    it("admits a valid workspace token, rejects a wrong-workspace token and a missing token", async () => {
      const server = createSyncServer({
        port: 0,
        authorize: createWorkspaceTokenAuthorizer(SECRET),
      })
      await server.listen()
      const url = `ws://127.0.0.1:${server.address.port}`
      const ws1Token = await issueWorkspaceToken("ws1", SECRET)

      // (a) valid token for a room in ws1 → admitted (any note/registry room under the workspace).
      const ok = new HocuspocusProvider({
        url,
        name: "ws1/note-42",
        document: new Y.Doc(),
        token: ws1Token,
      })
      // (b) the same ws1 token joining ws2 → rejected (transport-level project isolation).
      let wrongWsFailed = false
      const wrongWs = new HocuspocusProvider({
        url,
        name: "ws2/note-42",
        document: new Y.Doc(),
        token: ws1Token,
        onAuthenticationFailed: () => {
          wrongWsFailed = true
        },
      })
      // (c) no token → rejected.
      let noTokenFailed = false
      const noToken = new HocuspocusProvider({
        url,
        name: "ws1/note-42",
        document: new Y.Doc(),
        onAuthenticationFailed: () => {
          noTokenFailed = true
        },
      })

      try {
        await waitUntil(() => ok.synced && wrongWsFailed && noTokenFailed)
        expect(ok.synced).toBe(true)
        expect(wrongWs.synced).toBe(false)
        expect(noToken.synced).toBe(false)
      } finally {
        ok.destroy()
        wrongWs.destroy()
        noToken.destroy()
        await server.destroy()
      }
    }, 20000)
  })
})
