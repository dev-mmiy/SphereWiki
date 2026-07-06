import { openYjsNote, openYjsRegistry } from "@spherewiki/shared"
import { afterEach, describe, expect, it, vi } from "vitest"
import { connectRegistryToServer } from "./connect-registry"
import { connectNoteToServer } from "./connect-server"

// Capture the provider's constructor config at the transport boundary. The provider→server
// token handshake itself (accept / deny / wrong-room over a real socket) is pinned by the
// server's sync-server.test.ts with this same provider library; what belongs to the DESKTOP
// is that the connect seams forward ServerSyncOptions faithfully — token included.
const { providerConfigs } = vi.hoisted(() => ({
  providerConfigs: [] as Record<string, unknown>[],
}))
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    on = vi.fn()
    destroy = vi.fn()
    constructor(config: Record<string, unknown>) {
      providerConfigs.push(config)
    }
  },
}))

const lastConfig = (): Record<string, unknown> => {
  const config = providerConfigs.at(-1)
  if (config === undefined) throw new Error("no provider was constructed")
  return config
}

afterEach(() => {
  providerConfigs.length = 0
})

describe("connectNoteToServer", () => {
  it("presents the auth token to the provider when one is configured", () => {
    const note = openYjsNote()
    const disconnect = connectNoteToServer(note, {
      url: "ws://x",
      room: "ws1/note",
      token: "grant:ws1/note",
      onHydrated: () => {},
    })
    expect(lastConfig()).toMatchObject({
      url: "ws://x",
      name: "ws1/note",
      token: "grant:ws1/note",
    })
    disconnect()
    note.destroy()
  })

  it("presents no token when none is configured (open rooms stay zero-config)", () => {
    const note = openYjsNote()
    const disconnect = connectNoteToServer(note, {
      url: "ws://x",
      room: "ws1/note",
      onHydrated: () => {},
    })
    expect(lastConfig()).not.toHaveProperty("token")
    disconnect()
    note.destroy()
  })
})

describe("connectRegistryToServer", () => {
  it("presents the auth token to the provider when one is configured", () => {
    const registry = openYjsRegistry()
    const disconnect = connectRegistryToServer(registry, {
      url: "ws://x",
      room: "ws1/__registry__",
      token: "grant:ws1/__registry__",
      onHydrated: () => {},
    })
    expect(lastConfig()).toMatchObject({
      url: "ws://x",
      name: "ws1/__registry__",
      token: "grant:ws1/__registry__",
    })
    disconnect()
    registry.destroy()
  })

  it("presents no token when none is configured", () => {
    const registry = openYjsRegistry()
    const disconnect = connectRegistryToServer(registry, {
      url: "ws://x",
      room: "ws1/__registry__",
      onHydrated: () => {},
    })
    expect(lastConfig()).not.toHaveProperty("token")
    disconnect()
    registry.destroy()
  })
})
