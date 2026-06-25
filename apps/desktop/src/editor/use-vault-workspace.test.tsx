import type { OnSaveResult, RagAnswer, SuggestionProvider } from "@spherewiki/ai"
import { openYjsRegistry, type YjsBackedRegistry } from "@spherewiki/shared"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { devAuth } from "../auth-dev"
import type { ConnectRegistry } from "../sync/connect-registry"
import type { ConnectNote } from "../sync/connect-server"
import type { ConnectLocalPersistence } from "../sync/local-persistence"
import { useVaultWorkspace } from "./use-vault-workspace"

const LOCAL = { actor: "local", kind: "human" } as const

/** Flush pending microtasks + timers so async hydration (whenLoaded) settles. */
const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

/** A stable no-op body-sync transport (unstable refs would re-run the per-note effect). */
const noBodySync: ConnectNote = () => () => {}

/**
 * An in-process registry "super-peer" hub: a single ConnectRegistry that several hooks can
 * join. A change on any peer (or on `server`, simulating a remote peer) reaches every other
 * peer — modelling the real Hocuspocus broadcast so the note list can converge in tests.
 */
function registryHub(): { connect: ConnectRegistry; server: YjsBackedRegistry } {
  const server = openYjsRegistry()
  const peers = new Set<YjsBackedRegistry>()
  // A server-originated change (a test acting as a remote peer) fans out to all connected peers.
  server.onUpdate((u, info) => {
    if (!info.local) return
    for (const p of peers) p.applyUpdate(u)
  })
  const connect: ConnectRegistry = (reg, opts) => {
    reg.applyUpdate(server.encodeState())
    peers.add(reg)
    const off = reg.onUpdate((u, info) => {
      if (!info.local) return
      server.applyUpdate(u)
      for (const p of peers) if (p !== reg) p.applyUpdate(u)
    })
    opts.onHydrated()
    return () => {
      off()
      peers.delete(reg)
    }
  }
  return { connect, server }
}

/** Deterministic, peer-prefixed note ids so two replicas never collide. */
function ids(prefix: string): () => string {
  let n = 0
  return () => `${prefix}-${(++n).toString()}`
}

describe("useVaultWorkspace", () => {
  it("opens the first note with its outgoing links", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.notes.map((m) => m.title)).toEqual(["Home", "Getting Started", "Ideas"])
    expect(result.current.activeNote?.getText()).toContain("Welcome")
    expect(result.current.outgoing).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
  })

  it("computes backlinks for the active note", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Home is linked from both Getting Started and Ideas.
    expect(result.current.backlinks.map((m) => m.title).sort()).toEqual([
      "Getting Started",
      "Ideas",
    ])
  })

  it("switches notes and writes edits back to the vault", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    expect(result.current.activeNote?.getText()).toContain("AI auto-links")

    act(() => result.current.activeNote?.setText("# Ideas\n\n[[Getting Started]]\n", LOCAL))

    const gs = result.current.notes.find((m) => m.title === "Getting Started")
    act(() => {
      if (gs) result.current.select(gs.id)
    })
    expect(result.current.backlinks.map((m) => m.title)).toContain("Ideas")
  })

  it("commits and reverts the active note", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    act(() => result.current.commit("snap"))
    expect(result.current.versions).toHaveLength(1)
    const vid = result.current.versions[0]?.id

    act(() => result.current.activeNote?.setText("changed", LOCAL))
    act(() => {
      if (vid) result.current.revert(vid)
    })
    expect(result.current.activeNote?.getText()).toContain("Welcome")
  })

  it("runs the AI agent: applies edits and records an attributed version", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = devAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.applied).toBe(true)
    expect(result.current.versions.some((v) => v.origin.kind === "ai")).toBe(true)
    expect(result.current.activeNote?.getText()).toContain("tags:")
  })

  it("does nothing for a viewer (no write permission)", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const before = result.current.activeNote?.getText()
    const session = devAuth("viewer").session()
    if (session === null) throw new Error("expected a session")
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.applied).toBe(false)
    expect(res?.skippedReason).toBe("no-permission")
    expect(result.current.versions).toHaveLength(0)
    expect(result.current.activeNote?.getText()).toBe(before)
  })

  it("auto-links an unlinked mention of a sibling note", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = devAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    const gs = result.current.notes.find((m) => m.title === "Getting Started")
    act(() => {
      if (gs) result.current.select(gs.id)
    })
    act(() =>
      result.current.activeNote?.setText("# Getting Started\n\nSee Ideas for more.\n", LOCAL),
    )
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.links).toContain("Ideas")
    expect(result.current.activeNote?.getText()).toContain("[[Ideas]]")
  })

  it("persists the AI edit to the vault even if the note is switched mid-run", async () => {
    let resolveSuggest: (() => void) | null = null
    const deferred: SuggestionProvider = {
      suggest: () =>
        new Promise((resolve) => {
          resolveSuggest = () => resolve({ links: [], tags: [{ kind: "tag", tag: "aitag" }] })
        }),
    }
    const { result } = renderHook(() => useVaultWorkspace({ suggester: deferred }))
    const session = devAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    const homeId = result.current.activeId

    let run!: Promise<OnSaveResult>
    act(() => {
      run = result.current.aiOrganize(session)
    })
    // Switch away while the suggester promise is still pending.
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    await act(async () => {
      resolveSuggest?.()
      await run
    })
    // Back on Home: the AI edit reached both the vault and history despite the switch.
    act(() => result.current.select(homeId))
    expect(result.current.activeNote?.getText()).toContain("aitag")
    expect(result.current.versions.some((v) => v.origin.kind === "ai")).toBe(true)
  })

  it("answers a question with cited workspace notes (RAG)", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    let ans: RagAnswer | undefined
    await act(async () => {
      ans = await result.current.aiAsk("auto links notes")
    })
    expect(ans?.citations.map((c) => c.title)).toContain("Ideas")
    expect(ans?.answer.length ?? 0).toBeGreaterThan(0)
  })

  it("returns an empty answer for a blank query", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    let ans: RagAnswer | undefined
    await act(async () => {
      ans = await result.current.aiAsk("   ")
    })
    expect(ans?.citations).toHaveLength(0)
    expect(ans?.answer).toBe("")
  })

  it("seeds locally and connects no sync transport when no syncUrl is set (offline-first)", () => {
    let connects = 0
    const connect: ConnectNote = () => {
      connects++
      return () => {}
    }
    const { result } = renderHook(() => useVaultWorkspace({ connect }))
    expect(connects).toBe(0) // server is an enhancement, never a hard dependency
    expect(result.current.activeNote?.getText()).toContain("Welcome") // seeded from local vault
  })

  it("hydrates the active note from the super-peer, not the local seed, when syncing", () => {
    const connect: ConnectNote = (note, opts) => {
      // Simulate the server being authoritative for the room.
      note.setText("# Server Home\n", LOCAL)
      opts.onHydrated()
      return () => {}
    }
    const { result } = renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    expect(result.current.activeNote?.getText()).toBe("# Server Home\n")
    expect(result.current.activeNote?.getText()).not.toContain("Welcome")
  })

  it("never clobbers the vault when a synced room has not hydrated (offline / fast switch)", () => {
    const connect: ConnectNote = () => () => {} // connects but never hydrates
    const { result } = renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    const home = result.current.notes.find((m) => m.title === "Home")
    act(() => {
      if (home) result.current.select(home.id)
    })
    // The un-hydrated cleanup must not have overwritten Home's Markdown with "" —
    // its outgoing links (derived from the vault body) are still intact.
    expect(result.current.outgoing).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
  })

  it("reads a synced room offline from local CRDT persistence (no server needed)", async () => {
    // The local cache holds the last-synced content; the server never hydrates (offline).
    const localPersistence: ConnectLocalPersistence = (note) => ({
      whenLoaded: Promise.resolve().then(() => note.setText("# Offline Home\n", LOCAL)),
      destroy: () => {},
    })
    const connect: ConnectNote = () => () => {} // connects but never hydrates (offline)
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    await flush()
    expect(result.current.activeNote?.getText()).toBe("# Offline Home\n")
  })

  it("defers to the server when the local cache is empty (no clobber)", async () => {
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: Promise.resolve(), // nothing cached yet
      destroy: () => {},
    })
    const connect: ConnectNote = (note, opts) => {
      note.setText("# Server Home\n", LOCAL)
      opts.onHydrated()
      return () => {}
    }
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    await flush()
    expect(result.current.activeNote?.getText()).toBe("# Server Home\n")
  })

  it("tears down local CRDT persistence on unmount", async () => {
    let destroyed = 0
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: Promise.resolve(),
      destroy: () => {
        destroyed++
      },
    })
    // Stable refs: the effect depends on connect/localPersistence by identity.
    const connect: ConnectNote = () => () => {}
    const { unmount } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    await flush()
    unmount()
    expect(destroyed).toBe(1)
  })

  it("never writes an empty doc to the vault across a switch (no clobber, server unreachable)", async () => {
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: Promise.resolve(), // empty cache
      destroy: () => {},
    })
    const connect: ConnectNote = () => () => {} // never hydrates
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    const home = result.current.notes.find((m) => m.title === "Home")
    act(() => {
      if (home) result.current.select(home.id)
    })
    await flush()
    // The vault's Markdown was never overwritten with the empty pre-sync doc.
    expect(result.current.outgoing).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
  })

  it("never clobbers the vault when the server hydrates an empty room", async () => {
    // Models the REAL super-peer: `synced` fires even for an empty room, with no text set —
    // markHydrated must not persist that empty doc over the note's Markdown.
    const connect: ConnectNote = (_note, opts) => {
      opts.onHydrated()
      return () => {}
    }
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: Promise.resolve(),
      destroy: () => {},
    })
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    await flush()
    // Home's Markdown — and its derived outgoing links — survived the empty authoritative sync.
    expect(result.current.outgoing).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
  })

  it("persists the first edit to a synced room that hydrated empty (offline-first create)", async () => {
    const connect: ConnectNote = (_note, opts) => {
      opts.onHydrated() // authoritative-but-empty room
      return () => {}
    }
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: Promise.resolve(),
      destroy: () => {},
    })
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    await flush()
    act(() => result.current.activeNote?.setText("# Home\n\nonly [[Ideas]] now\n", LOCAL))
    // The first real edit reached the vault (non-empty, so the sync-mode guard allows it):
    // the graph, derived from the vault body, now reflects the edit rather than the seed.
    expect(result.current.outgoing).toEqual(["Ideas"])
  })

  it("disconnects the server provider on note switch and on unmount", async () => {
    let connects = 0
    let disconnects = 0
    const connect: ConnectNote = (_note, opts) => {
      connects++
      opts.onHydrated()
      return () => {
        disconnects++
      }
    }
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: Promise.resolve(),
      destroy: () => {},
    })
    const { result, unmount } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    await flush()
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    expect(disconnects).toBe(1) // the previous note's provider was torn down on switch
    unmount()
    expect(disconnects).toBe(connects) // every provider opened was disconnected
  })

  it("ignores a local-cache load that resolves after disposal (no use-after-destroy)", async () => {
    let resolve: (() => void) | null = null
    let destroyed = 0
    const localPersistence: ConnectLocalPersistence = () => ({
      whenLoaded: new Promise<void>((r) => {
        resolve = r
      }),
      destroy: () => {
        destroyed++
      },
    })
    const connect: ConnectNote = () => () => {}
    const { unmount } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect, localPersistence }),
    )
    unmount() // disposes before the cache resolves
    expect(destroyed).toBe(1) // torn down on unmount
    // Resolving now must hit the `disposed` guard: no throw, no resurrection.
    await act(async () => {
      resolve?.()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(destroyed).toBe(1)
  })

  it("persists the vault across a remount when persistVaultKey is set (offline durability)", () => {
    // Share one working storage across both mounts (the test env's localStorage is unreliable).
    const m = new Map<string, string>()
    const vaultStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
    }
    const opts = { persistVaultKey: "test:vault:durable", vaultStorage }
    const first = renderHook(() => useVaultWorkspace(opts))
    act(() => first.result.current.activeNote?.setText("# Home\n\npersisted body\n", LOCAL))
    first.unmount() // cleanup writes the doc back to the (durable) vault

    const second = renderHook(() => useVaultWorkspace(opts))
    expect(second.result.current.activeNote?.getText()).toContain("persisted body")
    second.unmount()
  })

  it("shows a note a remote peer added to the registry (list converges)", () => {
    const hub = registryHub()
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect: noBodySync, connectRegistry: hub.connect }),
    )
    // A remote peer creates a note in the shared registry.
    act(() =>
      hub.server.set("remote-1", { title: "Remote Note" }, { actor: "peer", kind: "human" }),
    )
    expect(result.current.notes.some((m) => m.id === "remote-1")).toBe(true)
    expect(result.current.notes.map((m) => m.title)).toContain("Remote Note")
    hub.server.destroy()
  })

  it("propagates a locally created note to the shared registry", () => {
    const hub = registryHub()
    const { result } = renderHook(() =>
      useVaultWorkspace({
        syncUrl: "ws://x",
        connect: noBodySync,
        connectRegistry: hub.connect,
        newNoteId: ids("local"),
      }),
    )
    act(() => result.current.create("Spec"))
    const titles = [...hub.server.entries().values()].map((e) => e.title)
    expect(titles).toContain("Spec") // reached the shared registry, so peers will see it
    hub.server.destroy()
  })

  it("converges two peers: a note created on A appears on B, with no id collision", () => {
    const hub = registryHub()
    const a = renderHook(() =>
      useVaultWorkspace({
        syncUrl: "ws://x",
        connect: noBodySync,
        connectRegistry: hub.connect,
        newNoteId: ids("a"),
      }),
    )
    const b = renderHook(() =>
      useVaultWorkspace({
        syncUrl: "ws://x",
        connect: noBodySync,
        connectRegistry: hub.connect,
        newNoteId: ids("b"),
      }),
    )
    act(() => a.result.current.create("Spec"))
    const onB = b.result.current.notes.find((m) => m.title === "Spec")
    expect(onB).toBeDefined()
    expect(onB?.id).toBe("a-4") // A's globally-unique id (3 seeds + 1), not one of B's b-* ids
    // B's own local seeds are untouched (additive, no data loss).
    expect(b.result.current.notes.map((m) => m.title)).toEqual(
      expect.arrayContaining(["Home", "Getting Started", "Ideas", "Spec"]),
    )
    a.unmount()
    b.unmount()
    hub.server.destroy()
  })

  it("seeds a newly created note's body into its synced doc (creator sees content)", () => {
    const hub = registryHub()
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect: noBodySync, connectRegistry: hub.connect }),
    )
    act(() => result.current.create("Spec"))
    // Despite the body transport never hydrating, the creator's editor shows the new note's
    // body (seeded from the vault: unique id, single author — not the double-seed case).
    expect(result.current.activeNote?.getText()).toContain("Spec")
    hub.server.destroy()
  })

  it("does not publish local seed notes into the shared registry (no double-seed)", () => {
    const hub = registryHub()
    const { unmount } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect: noBodySync, connectRegistry: hub.connect }),
    )
    // The default Home/Getting Started/Ideas stay local-only; the registry was never bulk-seeded.
    expect(hub.server.entries().size).toBe(0)
    unmount()
    hub.server.destroy()
  })

  it("keeps local notes when the registry hydrates empty (no data loss)", () => {
    const connectRegistry: ConnectRegistry = (_reg, opts) => {
      opts.onHydrated() // authoritative-but-empty registry
      return () => {}
    }
    const { result } = renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", connect: noBodySync, connectRegistry }),
    )
    expect(result.current.notes.map((m) => m.title)).toEqual(["Home", "Getting Started", "Ideas"])
  })
})
