import { can, extractWikiLinks, parseNote, type VersionStore } from "@spherewiki/shared"
import { contentHash } from "../embedding/hash"
import { buildAgentEdit } from "../suggest/apply"
import type { OnSaveDeps, OnSaveInput, OnSaveResult, SkipReason } from "./types"
import { AGENT_ACTOR } from "./types"

/**
 * The on-save AI agent — the architecturally load-bearing piece of M4a. Callable
 * identically by the desktop hook and a future server CRDT peer.
 *
 * Ordered effects (each gates the next):
 *  1. Permission gate — `can(session, workspaceId, "write")`; otherwise ZERO effects.
 *  2. Isolation — the supplied index must belong to the permission-checked workspace.
 *  3. Autonomy gate — `off` does nothing; `suggest` surfaces candidates without applying.
 *  4/5. Suggest, then (in `auto`) select up to the accept policy.
 *  6. THE ONLY WRITE PATH, applied against the LIVE text re-read after the awaits so a
 *     concurrent human edit is never clobbered: first ensure the pre-AI human text is in
 *     history (so the AI edit is revertible to it), then `note.setText(next,{kind:"ai"})`
 *     (minimal merge-safe diff) immediately followed by `store.commit(...)`.
 *  7. Re-embed the (possibly changed) BODY when its content hash differs.
 */
export async function runOnSaveAgent(input: OnSaveInput, deps: OnSaveDeps): Promise<OnSaveResult> {
  const agentId = input.agentId ?? AGENT_ACTOR
  const autonomy = input.autonomy ?? "auto"

  const skip = (reason: SkipReason): OnSaveResult => ({
    links: [],
    tags: [],
    versionId: null,
    applied: false,
    skippedReason: reason,
  })

  // 1. Permission gate — a session lacking write access produces no reads or writes.
  if (!can(input.session, input.workspaceId, "write")) return skip("no-permission")
  // 2. Isolation — refuse to write a vector into an index from another workspace.
  if (input.index.workspaceId !== input.workspaceId) {
    throw new Error(
      `index workspace ${input.index.workspaceId} != agent workspace ${input.workspaceId}`,
    )
  }
  // 3. Autonomy gate.
  if (autonomy === "off") return skip("autonomy-off")

  // 4. Suggest.
  const suggestions = await deps.suggester.suggest({
    note: { id: input.noteId, title: input.title, body: input.note.getText() },
    siblings: input.others,
  })

  // 5. Select (only `auto` auto-applies; `suggest` defers every candidate to human confirmation).
  const selectedLinks =
    autonomy === "auto"
      ? suggestions.links.slice(0, input.accept?.maxLinks ?? suggestions.links.length)
      : []
  const selectedTags =
    autonomy === "auto"
      ? suggestions.tags.slice(0, input.accept?.maxTags ?? suggestions.tags.length)
      : []

  // 6. Apply against the LIVE text (re-read after the await) so an interleaved human edit
  //    on the same note is merged, not overwritten.
  const live = input.note.getText()
  const next = buildAgentEdit(live, { links: selectedLinks, tags: selectedTags })
  let versionId: string | null = null
  let applied = false
  let appliedLinks: readonly string[] = []
  let appliedTags: readonly string[] = []
  if (next !== live) {
    // Capture the pre-AI human text in history first, so reverting the AI version restores it.
    if (headText(input.store) !== live) {
      input.store.commit(input.note, {
        origin: { actor: input.session.account.id, kind: "human" },
      })
    }
    input.note.setText(next, { actor: agentId, kind: "ai" })
    const version = input.store.commit(input.note, {
      origin: { actor: agentId, kind: "ai" },
      label: "ai:on-save",
    })
    versionId = version.id
    applied = true
    appliedLinks = appliedTitles(
      live,
      next,
      selectedLinks.map((l) => l.title),
      linkTargets,
    )
    appliedTags = appliedTitles(
      live,
      next,
      selectedTags.map((t) => t.tag),
      tagSet,
    )
  }

  // 7. Re-embed when the body's content hash has changed (also seeds a never-indexed note).
  const body = parseNote(input.note.getText()).body
  const hash = contentHash(body)
  if (input.index.hashOf(input.noteId) !== hash) {
    const [vector] = await deps.embedder.embed([body])
    if (vector !== undefined) {
      input.index.upsert({ noteId: input.noteId, title: input.title, vector, contentHash: hash })
    }
  }

  if (applied) {
    return { links: appliedLinks, tags: appliedTags, versionId, applied: true }
  }
  if (autonomy === "suggest") {
    return {
      links: [],
      tags: [],
      versionId: null,
      applied: false,
      skippedReason: "autonomy-suggest",
      suggested: {
        links: suggestions.links.map((l) => l.title),
        tags: suggestions.tags.map((t) => t.tag),
      },
    }
  }
  return skip("no-suggestions")
}

/** The text of the store's head version, or undefined when history is empty. */
function headText(store: VersionStore): string | undefined {
  const head = store.list().at(-1)
  if (head === undefined) return undefined
  const past = store.open(head.id)
  try {
    return past.getText()
  } finally {
    past.destroy()
  }
}

function linkTargets(text: string): Set<string> {
  return new Set(extractWikiLinks(parseNote(text).body).map((l) => l.target))
}

function tagSet(text: string): Set<string> {
  const tags = parseNote(text).frontmatter.tags
  return new Set(Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [])
}

/** Of the selected names, those that are present after the edit but were not before. */
function appliedTitles(
  before: string,
  after: string,
  selected: readonly string[],
  extract: (text: string) => Set<string>,
): readonly string[] {
  const had = extract(before)
  const has = extract(after)
  return selected.filter((name) => has.has(name) && !had.has(name))
}
