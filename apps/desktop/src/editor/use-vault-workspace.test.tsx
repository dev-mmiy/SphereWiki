import type { OnSaveResult, RagAnswer, SuggestionProvider } from "@spherewiki/ai"
import { openYjsRegistry, type YjsBackedRegistry } from "@spherewiki/shared"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { localAuth } from "../auth-local"
import { createAiMetricsRecorder } from "../metrics/ai-metrics"
import type { ConnectRegistry } from "../sync/connect-registry"
import type { ConnectNote, ServerSyncOptions } from "../sync/connect-server"
import type { ConnectLocalPersistence } from "../sync/local-persistence"
import type { ConnectRegistryPersistence } from "../sync/registry-persistence"
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

/**
 * An in-memory registry persistence whose backing buffer outlives a remount (a closure standing in
 * for the real IndexedDB store), so a test can prove the note list + tombstones reload offline with
 * no server. Loads the saved state into the doc on attach and re-saves on every change/destroy.
 */
function registryPersistenceStore(): ConnectRegistryPersistence {
  let saved: Uint8Array | null = null
  return (registry) => {
    if (saved !== null) registry.applyUpdate(saved)
    const off = registry.onUpdate(() => {
      saved = registry.encodeState()
    })
    return {
      whenLoaded: Promise.resolve(),
      destroy: () => {
        saved = registry.encodeState()
        off()
      },
    }
  }
}

describe("useVaultWorkspace", () => {
  it("opens the first note with its outgoing links", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.notes.map((m) => m.title)).toEqual(["Home", "Getting Started", "Ideas"])
    expect(result.current.activeNote?.getText()).toContain("Welcome")
    expect(result.current.outgoing.map((l) => l.title)).toEqual(
      expect.arrayContaining(["Getting Started", "Ideas"]),
    )
  })

  it("flags outgoing links as resolved or dangling", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Home's seed links both resolve to existing notes.
    expect(result.current.outgoing.every((l) => l.exists)).toBe(true)
    // Add a link to a note that doesn't exist → it shows up as dangling.
    act(() => result.current.activeNote?.setText("# Home\n\nsee [[Nowhere]]\n", LOCAL))
    expect(result.current.outgoing).toEqual([{ title: "Nowhere", exists: false }])
  })

  it("creating a dangling link's note resolves the link (graph gains the edge)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const homeId = result.current.activeId
    act(() => result.current.activeNote?.setText("# Home\n\nsee [[Nowhere]]\n", LOCAL))
    expect(result.current.outgoing).toEqual([{ title: "Nowhere", exists: false }])

    act(() => result.current.create("Nowhere"))

    // The note now exists and Home's previously-dangling link resolves to it.
    const nowhere = result.current.notes.find((m) => m.title === "Nowhere")
    expect(nowhere).toBeDefined()
    expect(result.current.graph.edges).toContainEqual({ from: homeId, to: nowhere?.id })
  })

  it("create() restores a trashed note instead of duplicating its title", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.remove(ideas.id))
    expect(result.current.notes.some((m) => m.title === "Ideas")).toBe(false)
    // A ghost/red-link click for the trashed title recreates by title — must restore, not dupe.
    act(() => result.current.create("Ideas"))
    const ideasNotes = result.current.notes.filter((m) => m.title === "Ideas")
    expect(ideasNotes).toHaveLength(1)
    expect(ideasNotes[0]?.id).toBe(ideas.id) // same note, body recovered (not a blank duplicate)
    expect(result.current.deleted.some((m) => m.id === ideas.id)).toBe(false)
  })

  it("create() selects an existing visible note rather than duplicating it", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.create("Ideas"))
    expect(result.current.notes.filter((m) => m.title === "Ideas")).toHaveLength(1)
    expect(result.current.activeId).toBe(ideas.id)
  })

  it("computes backlinks for the active note", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Home is linked from both Getting Started and Ideas.
    expect(result.current.backlinks.map((m) => m.title).sort()).toEqual([
      "Getting Started",
      "Ideas",
    ])
  })

  it("exposes a whole-workspace graph of notes and resolved wikilinks", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const { nodes, edges } = result.current.graph
    expect(nodes.map((n) => n.title).sort()).toEqual(["Getting Started", "Home", "Ideas"])
    // Edges resolve titles to ids; assert by title for readability.
    const titleOf = new Map(nodes.map((n) => [n.id, n.title]))
    const byTitle = edges.map((e) => `${titleOf.get(e.from)}->${titleOf.get(e.to)}`).sort()
    expect(byTitle).toEqual([
      "Getting Started->Home",
      "Home->Getting Started",
      "Home->Ideas",
      "Ideas->Home",
    ])
  })

  it("keeps the graph in step as the active note's links change", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const homeId = result.current.activeId
    act(() => result.current.activeNote?.setText("# Home\n\nnow isolated\n", LOCAL))
    const edgesFromHome = result.current.graph.edges.filter((e) => e.from === homeId)
    expect(edgesFromHome).toEqual([]) // Home no longer links out
    // Home is still a node, and its backlinks (Getting Started, Ideas) still point at it.
    expect(result.current.graph.nodes.some((n) => n.id === homeId)).toBe(true)
    expect(result.current.graph.edges.some((e) => e.to === homeId)).toBe(true)
  })

  it("exposes workspace metrics that track graph growth", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Seed: Home/Getting Started/Ideas, fully cross-linked, no tags.
    expect(result.current.metrics).toEqual({
      notes: 3,
      links: 4,
      unwrittenLinks: 0,
      tags: 0,
      taggedNotes: 0,
    })
    // Add a tag and a link to a not-yet-created note: tags + the frontier grow.
    act(() =>
      result.current.activeNote?.setText(
        "---\ntags:\n  - planning\n---\n# Home\n\n[[Roadmap]]\n",
        LOCAL,
      ),
    )
    expect(result.current.metrics.tags).toBe(1)
    expect(result.current.metrics.taggedNotes).toBe(1)
    expect(result.current.metrics.unwrittenLinks).toBe(1) // [[Roadmap]] has no note yet
  })

  it("searches the visible notes by content", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.search("welcome").map((h) => h.title)).toEqual(["Home"])
    expect(result.current.search("   ")).toEqual([]) // blank query
  })

  it("drops a trashed note from search results", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // "Getting Started" body says "Back to [[Home]]" — searchable while visible.
    expect(result.current.search("back").map((h) => h.title)).toEqual(["Getting Started"])
    const gs = result.current.notes.find((m) => m.title === "Getting Started")
    act(() => {
      if (gs) result.current.remove(gs.id)
    })
    // Once soft-deleted it leaves the visible set, so search no longer surfaces it.
    expect(result.current.search("back")).toEqual([])
  })

  it("exposes the active note's tags from its frontmatter", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.tags).toEqual([]) // seed Home has no frontmatter
    act(() =>
      result.current.activeNote?.setText(
        "---\ntags:\n  - planning\n  - ideas\n---\n# Home\n",
        LOCAL,
      ),
    )
    expect(result.current.tags).toEqual(["planning", "ideas"])
  })

  it("adds and removes tags on the active note (human tag curation)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.tags).toEqual([])
    act(() => result.current.addTag("planning"))
    expect(result.current.tags).toEqual(["planning"])
    act(() => result.current.addTag("planning")) // idempotent — no duplicate
    act(() => result.current.addTag("ideas"))
    expect(result.current.tags).toEqual(["planning", "ideas"])
    act(() => result.current.removeTag("planning"))
    expect(result.current.tags).toEqual(["ideas"])
    // The edit rides the note's CRDT doc — it's a normal versioned/synced body edit.
    expect(result.current.activeNote?.getText()).toContain("ideas")
  })

  it("refuses a tag edit until a synced note hydrates (no pre-hydration frontmatter write)", () => {
    const connect: ConnectNote = () => () => {} // connects but never hydrates
    const { result } = renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    expect(result.current.hydrated).toBe(false)
    act(() => result.current.addTag("planning"))
    // No-op: tags unchanged AND no frontmatter block was written into the (unhydrated) doc —
    // a later server-body merge would otherwise push it out of line 0 and corrupt the note.
    expect(result.current.tags).toEqual([])
    expect(result.current.activeNote?.getText() ?? "").not.toContain("tags:")
  })

  it("allows tag edits once a synced note hydrates", () => {
    const connect: ConnectNote = (_note, opts) => {
      opts.onHydrated()
      return () => {}
    }
    const { result } = renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    expect(result.current.hydrated).toBe(true)
    act(() => result.current.addTag("planning"))
    expect(result.current.tags).toEqual(["planning"])
  })

  it("reports sync status: 'local' with no sync configured", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    expect(result.current.syncStatus).toBe("local")
  })

  it("reports sync status: 'syncing' for a synced room until it hydrates", () => {
    const connect: ConnectNote = () => () => {} // connects but never hydrates
    const { result } = renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    expect(result.current.syncStatus).toBe("syncing")
  })

  it("reports sync status: 'synced' once a synced room hydrates", () => {
    const connect: ConnectNote = (_note, opts) => {
      opts.onHydrated()
      return () => {}
    }
    const { result } = renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    expect(result.current.syncStatus).toBe("synced")
  })

  it("threads the sync token into BOTH the note and registry connect seams", () => {
    // The room-auth client half: the server's RoomAuthorizer gates every room join, so the
    // token must reach the note-body room AND the registry room — a missing registry token
    // would sync bodies but never the note list.
    let noteToken: string | undefined
    let registryToken: string | undefined
    const connect: ConnectNote = (_note, opts) => {
      noteToken = opts.token
      return () => {}
    }
    const connectRegistry: ConnectRegistry = (_reg, opts) => {
      registryToken = opts.token
      return () => {}
    }
    renderHook(() =>
      useVaultWorkspace({ syncUrl: "ws://x", syncToken: "grant:ws", connect, connectRegistry }),
    )
    expect(noteToken).toBe("grant:ws")
    expect(registryToken).toBe("grant:ws")
  })

  it("presents no token when none is configured (open rooms stay zero-config)", () => {
    let noteOpts: ServerSyncOptions | undefined
    const connect: ConnectNote = (_note, opts) => {
      noteOpts = opts
      return () => {}
    }
    renderHook(() => useVaultWorkspace({ syncUrl: "ws://x", connect }))
    expect(noteOpts).toBeDefined()
    expect(noteOpts).not.toHaveProperty("token")
  })

  it("surfaces AI-added tags (auto-tag becomes visible)", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = localAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    expect(result.current.tags).toEqual([])
    await act(async () => {
      await result.current.aiOrganize(session)
    })
    expect(result.current.tags.length).toBeGreaterThan(0) // the agent's tags now show in the UI
  })

  it("records AI applies and reverts (the kept-vs-reverted signal)", async () => {
    const recorder = createAiMetricsRecorder() // in-memory
    const { result } = renderHook(() => useVaultWorkspace({ aiMetricsRecorder: recorder }))
    const session = localAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    expect(result.current.aiMetrics.applied).toBe(0)

    // The agent applies on the active note → one applied batch is recorded.
    await act(async () => {
      await result.current.aiOrganize(session)
    })
    expect(result.current.aiMetrics.applied).toBe(1)
    expect(result.current.aiMetrics.reverted).toBe(0)

    // The agent committed a pre-AI baseline then the AI version; reverting to the baseline
    // rolls back the AI edit → one reverted batch is recorded.
    const baseline = result.current.versions[0]
    if (baseline === undefined) throw new Error("expected a pre-AI baseline version")
    act(() => result.current.revert(baseline.id))
    expect(result.current.aiMetrics.reverted).toBe(1)
  })

  it("suggest mode surfaces candidates without applying them", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = localAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    act(() => result.current.setAiAutonomy("suggest"))
    let res: OnSaveResult | undefined
    await act(async () => {
      res = await result.current.aiOrganize(session)
    })
    expect(res?.applied).toBe(false)
    expect(res?.skippedReason).toBe("autonomy-suggest")
    expect(
      (res?.suggested?.links.length ?? 0) + (res?.suggested?.tags.length ?? 0),
    ).toBeGreaterThan(0)
    expect(result.current.tags).toEqual([]) // nothing was applied
    expect(result.current.aiMetrics.applied).toBe(0)
  })

  it("aiApplySuggestions applies a human-confirmed subset via the AI write path", async () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const session = localAuth("editor").session()
    if (session === null) throw new Error("expected a session")
    act(() => result.current.setAiAutonomy("suggest"))
    let suggested: OnSaveResult["suggested"]
    await act(async () => {
      suggested = (await result.current.aiOrganize(session)).suggested
    })
    const tags = [...(suggested?.tags ?? [])]
    expect(tags.length).toBeGreaterThan(0)

    // Confirm just the tags (no links) → they land, attributed + counted like an AI edit.
    let applied: OnSaveResult | undefined
    await act(async () => {
      applied = await result.current.aiApplySuggestions(session, { links: [], tags })
    })
    expect(applied?.applied).toBe(true)
    expect(result.current.tags).toEqual(expect.arrayContaining(tags))
    expect(result.current.aiMetrics.applied).toBe(1)
    // The applied edit is a revertible AI version in history.
    expect(result.current.versions.some((v) => v.origin.kind === "ai")).toBe(true)
  })

  it("groups visible notes by tag for navigation (notesForTag)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    act(() => result.current.activeNote?.setText("---\ntags:\n  - shared\n---\n# Home\n", LOCAL))
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    act(() => {
      if (ideas) result.current.select(ideas.id)
    })
    act(() => result.current.activeNote?.setText("---\ntags:\n  - shared\n---\n# Ideas\n", LOCAL))
    expect(
      result.current
        .notesForTag("shared")
        .map((m) => m.title)
        .sort(),
    ).toEqual(["Home", "Ideas"])
    expect(result.current.notesForTag("nonexistent")).toEqual([])

    // A trashed note must not surface in tag navigation (visible-notes-only, isolation).
    const ideasId = result.current.notes.find((m) => m.title === "Ideas")?.id
    act(() => {
      if (ideasId) result.current.remove(ideasId)
    })
    expect(result.current.notesForTag("shared").map((m) => m.title)).toEqual(["Home"])
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
    const session = localAuth("editor").session()
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
    const session = localAuth("viewer").session()
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
    const session = localAuth("editor").session()
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
    const session = localAuth("editor").session()
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
    expect(result.current.outgoing.map((l) => l.title)).toEqual(
      expect.arrayContaining(["Getting Started", "Ideas"]),
    )
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
    expect(result.current.outgoing.map((l) => l.title)).toEqual(
      expect.arrayContaining(["Getting Started", "Ideas"]),
    )
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
    expect(result.current.outgoing.map((l) => l.title)).toEqual(
      expect.arrayContaining(["Getting Started", "Ideas"]),
    )
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
    expect(result.current.outgoing.map((l) => l.title)).toEqual(["Ideas"])
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

  it("full local loop survives a reload (create / link / commit / delete / mode → reopen)", async () => {
    // Wire the whole local-mode persistence stack against one shared storage, like the real app:
    // the vault (bodies), the registry (list + trash), version history, and session prefs — then
    // remount to simulate a reload and assert every piece of state came back.
    const registryPersistence = registryPersistenceStore()
    const m = new Map<string, string>()
    const vaultStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
    }
    const opts = {
      persistVaultKey: "test:vault:loop",
      persistVersionsKey: "test:versions:loop",
      persistSessionKey: "test:session:loop",
      vaultStorage,
      registryPersistence,
      newNoteId: ids("loop"),
    }

    const first = renderHook(() => useVaultWorkspace(opts))
    await flush()
    // Create a note that links to Home, commit a restore point, then edit past it.
    act(() => first.result.current.create("Spec"))
    const specId = first.result.current.activeId
    act(() => first.result.current.activeNote?.setText("# Spec\n\nlinks to [[Home]]\n", LOCAL))
    act(() => first.result.current.commit("baseline"))
    const versionId = first.result.current.versions[0]?.id
    if (versionId === undefined) throw new Error("expected a committed version")
    act(() => first.result.current.activeNote?.setText("# Spec\n\nedited body\n", LOCAL))
    // Trash a seed note and switch the AI mode.
    const ideas = first.result.current.notes.find((n) => n.title === "Ideas")
    act(() => {
      if (ideas) first.result.current.remove(ideas.id)
    })
    act(() => first.result.current.setAiAutonomy("suggest"))
    expect(first.result.current.activeId).toBe(specId)
    first.unmount()

    // ---- Reload ----
    const second = renderHook(() => useVaultWorkspace(opts))
    await flush()

    // Session resumed: still on Spec, AI mode still "suggest".
    expect(second.result.current.activeId).toBe(specId)
    expect(second.result.current.aiAutonomy).toBe("suggest")
    // Vault: Spec's last edited body survived.
    expect(second.result.current.activeNote?.getText()).toContain("edited body")
    // Registry: Ideas is still trashed (and restorable), not back in the list.
    expect(second.result.current.notes.some((n) => n.title === "Ideas")).toBe(false)
    expect(second.result.current.deleted.some((n) => n.title === "Ideas")).toBe(true)
    // Version history: the restore point survived and reverting to it brings the link back.
    expect(second.result.current.versions.some((v) => v.id === versionId)).toBe(true)
    act(() => second.result.current.revert(versionId))
    expect(second.result.current.activeNote?.getText()).toContain("links to [[Home]]")
    // Derived graph follows the reverted body: Home now has a backlink from Spec.
    const home = second.result.current.notes.find((n) => n.title === "Home")
    act(() => {
      if (home) second.result.current.select(home.id)
    })
    expect(second.result.current.backlinks.some((n) => n.title === "Spec")).toBe(true)
    second.unmount()
  })

  it("resumes the last active note and AI mode across a remount (session prefs)", () => {
    const m = new Map<string, string>()
    const vaultStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
    }
    const opts = {
      persistVaultKey: "test:vault:session",
      persistSessionKey: "test:session",
      vaultStorage,
    }

    const first = renderHook(() => useVaultWorkspace(opts))
    const ideas = first.result.current.notes.find((x) => x.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => first.result.current.select(ideas.id))
    act(() => first.result.current.setAiAutonomy("suggest"))
    first.unmount()

    // Reload: a fresh hook backed by the SAME vault + session prefs.
    const second = renderHook(() => useVaultWorkspace(opts))
    expect(second.result.current.activeId).toBe(ideas.id) // resumed on Ideas, not the first note
    expect(second.result.current.aiAutonomy).toBe("suggest") // mode resumed too
    second.unmount()
  })

  it("persists version history across a remount (revert points survive a reload)", () => {
    const m = new Map<string, string>()
    const vaultStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
    }
    const opts = {
      persistVaultKey: "test:vault:hist",
      persistVersionsKey: "test:versions:hist",
      vaultStorage,
    }

    const first = renderHook(() => useVaultWorkspace(opts))
    act(() => first.result.current.activeNote?.setText("# Home\n\nv1 body\n", LOCAL))
    act(() => first.result.current.commit("snap-1"))
    expect(first.result.current.versions).toHaveLength(1)
    const vid = first.result.current.versions[0]?.id
    if (vid === undefined) throw new Error("expected a committed version")
    first.unmount()

    // Reload: a fresh hook backed by the SAME vault + version storage.
    const second = renderHook(() => useVaultWorkspace(opts))
    // The committed version survived the reload (loaded for the initially-active note).
    expect(second.result.current.versions.some((v) => v.id === vid)).toBe(true)
    expect(second.result.current.versions).toHaveLength(1)
    // And it's a working revert point: change the body, revert to the snapshot, get it back.
    act(() => second.result.current.activeNote?.setText("# Home\n\nchanged\n", LOCAL))
    act(() => second.result.current.revert(vid))
    expect(second.result.current.activeNote?.getText()).toContain("v1 body")
    second.unmount()
  })

  it("persists the registry across a remount with no sync — the trash survives a reload", async () => {
    const registryPersistence = registryPersistenceStore()
    // Share the vault store too, so the deleted note's body is still around after the "reload".
    const m = new Map<string, string>()
    const vaultStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v)
      },
    }
    const opts = { persistVaultKey: "test:vault:trash", vaultStorage, registryPersistence }

    const first = renderHook(() => useVaultWorkspace(opts))
    await flush()
    const ideas = first.result.current.notes.find((x) => x.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => first.result.current.remove(ideas.id))
    expect(first.result.current.notes.some((x) => x.title === "Ideas")).toBe(false)
    expect(first.result.current.deleted.some((x) => x.id === ideas.id)).toBe(true)
    first.unmount()

    // Reload: a fresh hook backed by the SAME vault + registry persistence (no sync configured).
    const second = renderHook(() => useVaultWorkspace(opts))
    await flush()
    // The tombstone survived: Ideas is still out of the list and in the trash, and restorable.
    expect(second.result.current.notes.some((x) => x.title === "Ideas")).toBe(false)
    expect(second.result.current.deleted.some((x) => x.id === ideas.id)).toBe(true)
    act(() => second.result.current.restore(ideas.id))
    expect(second.result.current.notes.some((x) => x.title === "Ideas")).toBe(true)
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

  it("soft-deletes a note (hidden from the list, kept in trash, body retained, revertible)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.remove(ideas.id))
    expect(result.current.notes.map((m) => m.title)).not.toContain("Ideas")
    expect(result.current.deleted.map((m) => m.title)).toContain("Ideas")

    act(() => result.current.restore(ideas.id))
    expect(result.current.notes.map((m) => m.title)).toContain("Ideas")
    expect(result.current.deleted).toHaveLength(0)
    // The body was never erased by the delete — it's intact after restore.
    act(() => result.current.select(ideas.id))
    expect(result.current.activeNote?.getText()).toContain("AI auto-links")
  })

  it("moves off the active note when it is deleted (switches to a visible note)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const home = result.current.activeId // Home is active initially
    act(() => result.current.remove(home))
    expect(result.current.activeId).not.toBe(home)
    expect(result.current.notes.some((m) => m.id === result.current.activeId)).toBe(true)
  })

  it("hides the editor when the last visible note is deleted, and restores it", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const all = result.current.notes.map((m) => m.id)
    act(() => {
      for (const id of all) result.current.remove(id)
    })
    expect(result.current.notes).toHaveLength(0)
    // No editable editor is left bound to a tombstoned note (body is retained, restorable).
    expect(result.current.activeNote).toBeNull()
    const activeId = result.current.activeId
    act(() => result.current.restore(activeId))
    expect(result.current.activeNote).not.toBeNull()
    expect(result.current.notes.some((m) => m.id === activeId)).toBe(true)
  })

  it("renames a note and repoints its backlinks (link integrity, no dangling links)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Home is active and links to [[Ideas]]; rename Ideas → Concepts.
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.rename(ideas.id, "Concepts"))

    // The list label changed; no "Ideas" remains.
    expect(result.current.notes.map((m) => m.title)).toContain("Concepts")
    expect(result.current.notes.map((m) => m.title)).not.toContain("Ideas")
    // The active note (Home) was repointed live: it links to Concepts, not the dangling Ideas.
    expect(result.current.activeNote?.getText()).toContain("[[Concepts]]")
    expect(result.current.activeNote?.getText()).not.toContain("[[Ideas]]")
    expect(result.current.outgoing.map((l) => l.title)).toContain("Concepts")
    expect(result.current.outgoing.map((l) => l.title)).not.toContain("Ideas")

    // The renamed note's backlinks still resolve under the new title.
    act(() => result.current.select(ideas.id))
    expect(result.current.backlinks.map((m) => m.title)).toContain("Home")
  })

  it("repoints backlinks in ALL non-active notes that reference the renamed note", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    // Both "Getting Started" and "Ideas" link to [[Home]]; rename Home while neither is active.
    const home = result.current.activeId
    act(() => result.current.rename(home, "Index"))
    for (const title of ["Getting Started", "Ideas"]) {
      const m = result.current.notes.find((x) => x.title === title)
      act(() => {
        if (m) result.current.select(m.id)
      })
      expect(result.current.activeNote?.getText()).toContain("[[Index]]")
      expect(result.current.activeNote?.getText()).not.toContain("[[Home]]")
    }
  })

  it("preserves alias and anchor when repointing backlinks", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    act(() =>
      result.current.activeNote?.setText(
        "# Home\n\n[[Ideas|brainstorm]] and [[Ideas#top]]\n",
        LOCAL,
      ),
    )
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.rename(ideas.id, "Concepts"))
    expect(result.current.activeNote?.getText()).toContain("[[Concepts|brainstorm]]")
    expect(result.current.activeNote?.getText()).toContain("[[Concepts#top]]")
  })

  it("makes the active note's body link-rewrite revertible (it rode the CRDT doc)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    act(() => result.current.commit("before rename"))
    const vid = result.current.versions[0]?.id
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.rename(ideas.id, "Concepts"))
    expect(result.current.activeNote?.getText()).toContain("[[Concepts]]")
    // Revert the active note's body to before the rename → the old link text returns.
    // (The title is a separate registry-level edit, reversed by renaming back — not body history.)
    act(() => {
      if (vid) result.current.revert(vid)
    })
    expect(result.current.activeNote?.getText()).toContain("[[Ideas]]")
  })

  it("refuses to rename to a title already used by another visible note (no ambiguous links)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.rename(ideas.id, "Home")) // Home already exists → must no-op
    expect(result.current.notes.filter((m) => m.title === "Home")).toHaveLength(1)
    expect(result.current.notes.some((m) => m.title === "Ideas")).toBe(true)
  })

  it("converges a rename's title across peers (registry last-writer-wins)", () => {
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
    act(() => a.result.current.create("Draft"))
    const draft = a.result.current.notes.find((m) => m.title === "Draft")
    if (draft === undefined) throw new Error("expected Draft")
    act(() => a.result.current.rename(draft.id, "Spec"))
    // Peer B sees the renamed title — the note list title converges.
    expect(b.result.current.notes.find((m) => m.id === draft.id)?.title).toBe("Spec")
    a.unmount()
    b.unmount()
    hub.server.destroy()
  })

  it("keeps the vault's own title metadata in step after rename (no drift)", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    // Rename twice: a stale vault title would feed the wrong oldTitle to the 2nd rename and dangle.
    act(() => result.current.rename(ideas.id, "Concepts"))
    act(() => result.current.rename(ideas.id, "Themes"))
    expect(result.current.notes.find((m) => m.id === ideas.id)?.title).toBe("Themes")
    // Home (active) links to the renamed note: after two renames it points at the final title only.
    expect(result.current.activeNote?.getText()).toContain("[[Themes]]")
    expect(result.current.activeNote?.getText()).not.toContain("[[Concepts]]")
    expect(result.current.activeNote?.getText()).not.toContain("[[Ideas]]")
  })

  it("is a no-op for a blank or unchanged title", () => {
    const { result } = renderHook(() => useVaultWorkspace())
    const before = result.current.notes.map((m) => m.title)
    const ideas = result.current.notes.find((m) => m.title === "Ideas")
    if (ideas === undefined) throw new Error("expected Ideas")
    act(() => result.current.rename(ideas.id, "   "))
    act(() => result.current.rename(ideas.id, "Ideas"))
    expect(result.current.notes.map((m) => m.title)).toEqual(before)
    expect(result.current.activeNote?.getText()).toContain("[[Ideas]]")
  })

  it("propagates a rename to the shared registry (peers converge on the new title)", () => {
    const hub = registryHub()
    const { result } = renderHook(() =>
      useVaultWorkspace({
        syncUrl: "ws://x",
        connect: noBodySync,
        connectRegistry: hub.connect,
        newNoteId: ids("a"),
      }),
    )
    act(() => result.current.create("Draft"))
    const draft = result.current.notes.find((m) => m.title === "Draft")
    if (draft === undefined) throw new Error("expected Draft")
    act(() => result.current.rename(draft.id, "Spec"))
    expect(hub.server.get(draft.id)?.title).toBe("Spec") // a peer would see the new title
    hub.server.destroy()
  })

  it("hides a note when a peer tombstones it, then restores it (no data loss)", () => {
    const hub = registryHub()
    const { result } = renderHook(() =>
      useVaultWorkspace({
        syncUrl: "ws://x",
        connect: noBodySync,
        connectRegistry: hub.connect,
        newNoteId: ids("a"),
      }),
    )
    act(() => result.current.create("Spec"))
    const spec = result.current.notes.find((m) => m.title === "Spec")
    if (spec === undefined) throw new Error("expected Spec")
    // A remote peer deletes it.
    act(() =>
      hub.server.set(spec.id, { title: "Spec", deleted: true }, { actor: "peer", kind: "human" }),
    )
    expect(result.current.notes.some((m) => m.id === spec.id)).toBe(false)
    expect(result.current.deleted.some((m) => m.id === spec.id)).toBe(true)
    // Restorable — a peer delete hides but never destroys.
    act(() => result.current.restore(spec.id))
    expect(result.current.notes.some((m) => m.id === spec.id)).toBe(true)
    hub.server.destroy()
  })
})
