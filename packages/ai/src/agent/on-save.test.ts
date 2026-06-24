import {
  asNoteId,
  asWorkspaceId,
  createMemoryVersionStore,
  type EditOrigin,
  openYjsNote,
  parseNote,
  type Session,
  yjsEngine,
} from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { contentHash } from "../embedding/hash"
import { createLocalEmbedder } from "../embedding/local"
import { createMemoryVectorIndex } from "../index-store/memory"
import { createHeuristicSuggester } from "../suggest/heuristic"
import type { NoteContext, SuggestionProvider } from "../suggest/types"
import { runOnSaveAgent } from "./on-save"
import { AGENT_ACTOR, type OnSaveDeps, type OnSaveInput } from "./types"

const HUMAN: EditOrigin = { actor: "u1", kind: "human" }
const ws = asWorkspaceId("ws1")
const noteId = asNoteId("home")

function session(role: "editor" | "viewer"): Session {
  return {
    account: { id: "u1", email: "u1@example.com" },
    orgId: "o1",
    memberships: [{ workspaceId: ws, role }],
  }
}

const SIBLINGS: readonly NoteContext[] = [
  { id: asNoteId("gs"), title: "Getting Started", body: "" },
  { id: asNoteId("ideas"), title: "Ideas", body: "" },
]

function setup(role: "editor" | "viewer", body: string) {
  const note = openYjsNote()
  note.setText(body, HUMAN)
  const store = createMemoryVersionStore(yjsEngine)
  const index = createMemoryVectorIndex(ws, createLocalEmbedder().info)
  const deps: OnSaveDeps = {
    suggester: createHeuristicSuggester(),
    embedder: createLocalEmbedder(),
  }
  const base: OnSaveInput = {
    session: session(role),
    workspaceId: ws,
    noteId,
    title: "Home",
    note,
    store,
    index,
    others: SIBLINGS,
  }
  return { note, store, index, deps, base }
}

describe("runOnSaveAgent", () => {
  it("applies links + tags as an attributed, revertible AI version", async () => {
    const { note, store, index, deps, base } = setup(
      "editor",
      "# Home\n\nSee Getting Started and Ideas for more.\n",
    )
    const baseline = store.commit(note, { origin: HUMAN })
    const preText = note.getText()

    const result = await runOnSaveAgent(base, deps)

    expect(result.applied).toBe(true)
    expect(note.getText()).toContain("[[Getting Started]]")
    expect(note.getText()).toContain("[[Ideas]]")
    expect(result.links).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
    expect(result.tags.length).toBeGreaterThan(0)

    const aiVersion = store.list().at(-1)
    expect(aiVersion?.origin.kind).toBe("ai")
    expect(aiVersion?.label).toBe("ai:on-save")
    expect(result.versionId).toBe(aiVersion?.id)
    expect(aiVersion?.parentId).toBe(baseline.id)

    // Revert source: the parent version still holds the pre-AI human text.
    const parentId = aiVersion?.parentId
    if (parentId === undefined) throw new Error("expected a parent version")
    const past = store.open(parentId)
    try {
      expect(past.getText()).toBe(preText)
    } finally {
      past.destroy()
    }

    // Embeddings track content: the index hash matches the new body and the note is retrievable.
    const body = parseNote(note.getText()).body
    expect(index.hashOf(noteId)).toBe(contentHash(body))
    const [queryVector] = await deps.embedder.embed([body])
    if (queryVector === undefined) throw new Error("no vector")
    expect(index.search(queryVector, 1)[0]?.noteId).toBe(noteId)
  })

  it("does nothing without write permission", async () => {
    const { note, store, index, deps, base } = setup("viewer", "See Getting Started.\n")
    const before = note.getText()
    const result = await runOnSaveAgent(base, deps)
    expect(result).toMatchObject({
      applied: false,
      skippedReason: "no-permission",
      versionId: null,
    })
    expect(note.getText()).toBe(before)
    expect(store.list()).toHaveLength(0)
    expect(index.records()).toHaveLength(0)
  })

  it("does nothing when autonomy is off", async () => {
    const { note, store, deps, base } = setup("editor", "See Getting Started.\n")
    const before = note.getText()
    const result = await runOnSaveAgent({ ...base, autonomy: "off" }, deps)
    expect(result.skippedReason).toBe("autonomy-off")
    expect(note.getText()).toBe(before)
    expect(store.list()).toHaveLength(0)
  })

  it("reports no-suggestions but still seeds the index on first save", async () => {
    const { note, store, index, deps, base } = setup("editor", "the and of see\n")
    const result = await runOnSaveAgent({ ...base, others: [] }, deps)
    expect(result.applied).toBe(false)
    expect(result.skippedReason).toBe("no-suggestions")
    expect(store.list()).toHaveLength(0)
    expect(note.getText()).toBe("the and of see\n")
    expect(index.hashOf(noteId)).toBe(contentHash("the and of see\n"))
  })

  it("respects the accept policy", async () => {
    const { deps, base } = setup("editor", "See Getting Started and Ideas.\n")
    const result = await runOnSaveAgent({ ...base, accept: { maxLinks: 1, maxTags: 0 } }, deps)
    expect(result.links).toHaveLength(1)
    expect(result.tags).toHaveLength(0)
  })

  it("does not clobber a concurrent human edit (merge-safe)", async () => {
    const { note, deps, base } = setup("editor", "# Home\n\nSee Getting Started.\n")
    // A concurrent replica appends a human edit at the very end.
    const replica = openYjsNote(note.encodeState())
    replica.setText(`${replica.getText()}Human footer.\n`, HUMAN)
    // The AI edits the primary note.
    await runOnSaveAgent(base, deps)
    // Merge both ways: both edits survive and converge.
    note.applyUpdate(replica.encodeState())
    replica.applyUpdate(note.encodeState())
    const merged = note.getText()
    expect(merged).toContain("[[Getting Started]]")
    // The footer survives exactly once, at the end — a destructive (non-minimal) write would
    // duplicate or drop it on merge.
    expect(merged.match(/Human footer\./g)).toHaveLength(1)
    expect(merged.endsWith("Human footer.\n")).toBe(true)
    expect(replica.getText()).toBe(merged)
    note.destroy()
    replica.destroy()
  })

  it("does not clobber a human edit made on the SAME note during the suggester await", async () => {
    const { note, deps, base } = setup("editor", "# Home\n\nSee Getting Started.\n")
    // The human keeps typing into the same note while the agent "thinks".
    const racingSuggester: SuggestionProvider = {
      suggest: () => {
        note.setText(`${note.getText()}\nIMPORTANT human sentence.\n`, HUMAN)
        return Promise.resolve({
          links: [{ kind: "link", title: "Getting Started", targetId: asNoteId("gs") }],
          tags: [],
        })
      },
    }
    const result = await runOnSaveAgent(base, { ...deps, suggester: racingSuggester })
    expect(result.applied).toBe(true)
    expect(note.getText()).toContain("IMPORTANT human sentence.") // human work preserved
    expect(note.getText()).toContain("[[Getting Started]]") // AI work applied against live text
    note.destroy()
  })

  it("captures a pre-AI baseline so the AI edit reverts to human text", async () => {
    const { note, store, deps, base } = setup("editor", "# Home\n\nSee Getting Started.\n")
    const preText = note.getText()
    const result = await runOnSaveAgent(base, deps) // no manual baseline committed
    expect(result.applied).toBe(true)
    const versions = store.list()
    expect(versions).toHaveLength(2) // human baseline + ai
    expect(versions[0]?.origin.kind).toBe("human")
    const aiVersion = versions.at(-1)
    expect(aiVersion?.origin.kind).toBe("ai")
    const parentId = aiVersion?.parentId
    if (parentId === undefined) throw new Error("expected a parent version")
    const past = store.open(parentId)
    try {
      expect(past.getText()).toBe(preText)
    } finally {
      past.destroy()
    }
  })

  it("attributes the AI version to the agent actor (default and custom)", async () => {
    const a = setup("editor", "See Getting Started.\n")
    await runOnSaveAgent(a.base, a.deps)
    expect(a.store.list().at(-1)?.origin.actor).toBe(AGENT_ACTOR)

    const b = setup("editor", "See Getting Started.\n")
    await runOnSaveAgent({ ...b.base, agentId: "custom-bot" }, b.deps)
    expect(b.store.list().at(-1)?.origin.actor).toBe("custom-bot")
  })

  it("is a no-op on a second identical save", async () => {
    const { note, store, deps, base } = setup("editor", "See Getting Started and Ideas.\n")
    const r1 = await runOnSaveAgent(base, deps)
    expect(r1.applied).toBe(true)
    const versionsAfter1 = store.list().length
    const textAfter1 = note.getText()
    const r2 = await runOnSaveAgent(base, deps)
    expect(r2.applied).toBe(false)
    expect(r2.skippedReason).toBe("no-suggestions")
    expect(store.list()).toHaveLength(versionsAfter1)
    expect(note.getText()).toBe(textAfter1)
  })

  it("in suggest mode returns candidates without applying, but still seeds the index", async () => {
    const { note, store, index, deps, base } = setup("editor", "See Getting Started and Ideas.\n")
    const before = note.getText()
    const result = await runOnSaveAgent({ ...base, autonomy: "suggest" }, deps)
    expect(result.applied).toBe(false)
    expect(result.skippedReason).toBe("autonomy-suggest")
    expect(result.suggested?.links).toEqual(expect.arrayContaining(["Getting Started", "Ideas"]))
    expect(note.getText()).toBe(before)
    expect(store.list()).toHaveLength(0)
    expect(index.hashOf(noteId)).toBeDefined()
  })
})
