import {
  type Answerer,
  createExtractiveAnswerer,
  createHeuristicSuggester,
  createLocalEmbedder,
  createMemoryVectorIndex,
  createRagRetriever,
  type EmbeddingProvider,
  type NoteContext,
  type OnSaveResult,
  type RagAnswer,
  type RagRetriever,
  reindexWorkspace,
  runOnSaveAgent,
  type SuggestionProvider,
  type VectorIndex,
} from "@spherewiki/ai"
import {
  asNoteId,
  buildLinkGraph,
  buildTagIndex,
  createMemoryVault,
  createMemoryVersionStore,
  type DiffChunk,
  type EditOrigin,
  type LinkGraph,
  type NoteId,
  type NoteMeta,
  openYjsNote,
  openYjsRegistry,
  parseNote,
  type RegistryEntry,
  renameWikiLinkTargets,
  type Session,
  type TagIndex,
  textDiff,
  type Vault,
  type Version,
  type VersionStore,
  type WorkspaceId,
  type YjsBackedNote,
  type YjsBackedRegistry,
  yjsEngine,
} from "@spherewiki/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { WORKSPACE_ID } from "../auth-dev"
import { type ConnectRegistry, connectRegistryToServer } from "../sync/connect-registry"
import { type ConnectNote, connectNoteToServer } from "../sync/connect-server"
import type { ConnectLocalPersistence, LocalDocPersistence } from "../sync/local-persistence"
import type { ConnectRegistryPersistence } from "../sync/registry-persistence"
import { createLocalStorageVault } from "../vault/local-vault"

/** The reserved registry room id; note ids are UUIDs and can never equal it. */
const REGISTRY_ROOM = "__registry__"

const LOCAL: EditOrigin = { actor: "local", kind: "human" }

const SEED: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Home", body: "# Home\n\nWelcome. See [[Getting Started]] and [[Ideas]].\n" },
  { title: "Getting Started", body: "# Getting Started\n\nBack to [[Home]].\n" },
  { title: "Ideas", body: "# Ideas\n\n- AI auto-links notes\n- See [[Home]]\n" },
]

function computeGraph(vault: Vault): LinkGraph {
  return buildLinkGraph(vault.list().map((m) => ({ id: m.id, body: vault.read(m.id) })))
}

function computeTags(vault: Vault): TagIndex {
  return buildTagIndex(vault.list().map((m) => ({ id: m.id, body: vault.read(m.id) })))
}

export interface VaultWorkspace {
  readonly notes: readonly NoteMeta[]
  readonly activeId: NoteId
  readonly activeNote: YjsBackedNote | null
  readonly outgoing: readonly string[]
  readonly backlinks: readonly NoteMeta[]
  /** The active note's tags, read from its frontmatter (derived from Markdown). */
  readonly tags: readonly string[]
  /** Visible notes carrying a given tag — for tag-based navigation (workspace-scoped). */
  notesForTag: (tag: string) => readonly NoteMeta[]
  readonly versions: readonly Version[]
  /** Tombstoned notes still recoverable locally (the "trash"). */
  readonly deleted: readonly NoteMeta[]
  select: (id: NoteId) => void
  selectByTitle: (title: string) => void
  create: (title: string) => void
  /**
   * Rename a note: update its display title (the registry is the title authority and converges
   * to peers via last-writer-wins) and atomically repoint every `[[old title]]` backlink across
   * the vault, so no dangling link is left behind. The open note's body change rides the CRDT
   * doc, so it syncs and is revertible like any body edit. No-op on a blank, unchanged, or
   * already-taken (by another visible note) title. The title itself is reversed by renaming back
   * — it is a registry-level edit, not part of per-note body history (like delete/restore).
   */
  rename: (id: NoteId, title: string) => void
  /** Soft-delete a note: hidden from the list across peers, body retained, revertible. */
  remove: (id: NoteId) => void
  /** Restore a soft-deleted note. */
  restore: (id: NoteId) => void
  commit: (label?: string) => void
  revert: (id: string) => void
  diffAgainstCurrent: (id: string) => DiffChunk[]
  /** Run the on-save AI agent on the active note; AI edits land as attributed, revertible versions. */
  aiOrganize: (session: Session) => Promise<OnSaveResult>
  /** True while an AI run is in flight (so the UI can prevent concurrent runs). */
  readonly aiBusy: boolean
  /** RAG question-answering scoped to this workspace; returns a cited answer. */
  aiAsk: (query: string) => Promise<RagAnswer>
}

export interface UseVaultWorkspaceOptions {
  readonly workspaceId?: WorkspaceId
  /** Inject AI providers (the real Claude/ONNX backends at M4b; deterministic stubs in tests). */
  readonly suggester?: SuggestionProvider
  readonly embedder?: EmbeddingProvider
  /** When set, the active note syncs live through the super-peer at this WebSocket URL. */
  readonly syncUrl?: string
  /** Inject the sync transport (the real super-peer in the app; a fake in tests). */
  readonly connect?: ConnectNote
  /**
   * Inject local CRDT persistence for *synced* rooms (the real IndexedDB store in the
   * app; an in-memory fake in tests). Only used when `syncUrl` is set; it makes a
   * synced room readable offline by loading its last-synced state from a local cache.
   */
  readonly localPersistence?: ConnectLocalPersistence
  /** Inject the registry sync transport (the real super-peer in the app; a fake in tests). */
  readonly connectRegistry?: ConnectRegistry
  /** Inject local CRDT persistence for the registry doc (real IndexedDB in the app; a fake in tests). */
  readonly registryPersistence?: ConnectRegistryPersistence
  /** When set, the vault is durably persisted to localStorage under this key (survives reload). */
  readonly persistVaultKey?: string
  /** Storage backend for the durable vault; defaults to window.localStorage (injectable for tests). */
  readonly vaultStorage?: Pick<Storage, "getItem" | "setItem">
  /** Note-id generator threaded into the durable vault (injectable for deterministic tests). */
  readonly newNoteId?: () => string
}

/**
 * Owns the in-memory vault, the active note's CRDT doc (recreated on switch,
 * seeded from the vault and writing edits back), per-note version stores, and
 * the derived link graph. The active note is exposed only when it matches the
 * active id, so consumers never bind to a stale doc during a switch.
 */
export function useVaultWorkspace(options: UseVaultWorkspaceOptions = {}): VaultWorkspace {
  const workspaceId = options.workspaceId ?? WORKSPACE_ID
  const syncUrl = options.syncUrl
  const vaultRef = useRef<Vault | null>(null)
  if (vaultRef.current === null) {
    vaultRef.current =
      options.persistVaultKey !== undefined
        ? createLocalStorageVault(SEED, {
            key: options.persistVaultKey,
            ...(options.vaultStorage !== undefined ? { storage: options.vaultStorage } : {}),
            ...(options.newNoteId !== undefined ? { newId: options.newNoteId } : {}),
          })
        : createMemoryVault(
            SEED,
            options.newNoteId !== undefined ? { newId: options.newNoteId } : {},
          )
  }
  const vault = vaultRef.current

  // The workspace note registry: a CRDT of the note LIST (id -> title), synced over a
  // workspace-level room so a note created on one peer appears on the others. Hook-lifetime
  // like the vault; the .ydoc only ever reaches the desktop registry transport seams.
  const registryRef = useRef<YjsBackedRegistry | null>(null)
  if (registryRef.current === null) registryRef.current = openYjsRegistry()
  const registry = registryRef.current
  // Ids of notes this client just created, whose body should be seeded into the synced doc
  // (unique id + single author -> safe; this is NOT the shared-seed double-seed case).
  const pendingSeedRef = useRef<Set<NoteId>>(new Set())

  // Per-workspace AI: a deterministic local embedder + heuristic suggester + an isolated
  // vector index sealed to this workspace. The real Claude/ONNX/pgvector backends slot in
  // behind these same seams at M4b.
  const aiRef = useRef<{
    embedder: EmbeddingProvider
    suggester: SuggestionProvider
    index: VectorIndex
    retriever: RagRetriever
    answerer: Answerer
  } | null>(null)
  if (aiRef.current === null) {
    const embedder = options.embedder ?? createLocalEmbedder()
    const index = createMemoryVectorIndex(workspaceId, embedder.info)
    aiRef.current = {
      embedder,
      suggester: options.suggester ?? createHeuristicSuggester(),
      index,
      // readBody returns the embedded text (the body) so the retriever's staleness check matches.
      retriever: createRagRetriever({
        embedder,
        project: index,
        readBody: (id) => parseNote(vault.read(id)).body,
      }),
      answerer: createExtractiveAnswerer(),
    }
  }
  const aiBusyRef = useRef(false)

  const storesRef = useRef(new Map<NoteId, VersionStore>())
  const storeFor = useCallback((id: NoteId): VersionStore => {
    const stores = storesRef.current
    let store = stores.get(id)
    if (store === undefined) {
      store = createMemoryVersionStore(yjsEngine)
      stores.set(id, store)
    }
    return store
  }, [])

  const [notes, setNotes] = useState<readonly NoteMeta[]>(() => vault.list())
  const [activeId, setActiveId] = useState<NoteId>(() => {
    const first = vault.list()[0]
    if (first === undefined) throw new Error("vault must seed at least one note")
    return first.id
  })
  const [active, setActive] = useState<{ id: NoteId; note: YjsBackedNote } | null>(null)
  const [graph, setGraph] = useState<LinkGraph>(() => computeGraph(vault))
  // The tag index mirrors `graph`: both are derived from the vault's Markdown and recomputed
  // imperatively in lockstep on every body change (a memo can't observe non-state body edits).
  const [tagIndex, setTagIndex] = useState<TagIndex>(() => computeTags(vault))
  const [versions, setVersions] = useState<readonly Version[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [deleted, setDeleted] = useState<readonly NoteMeta[]>([])

  // Live active id, read by callbacks that outlive a render: an in-flight AI run (to tell if the
  // user switched away) and the registry reconcile (to move off a note a peer just deleted).
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // The displayed note list: the local vault (every reconciled registry note is materialized
  // into it) with the registry's title winning for display so a remote rename shows. Purely
  // additive — a local note absent from the registry is always kept, never hidden or removed —
  // except an explicit, revertible tombstone (`deleted`), which hides the note from the list.
  const unionList = useCallback((): NoteMeta[] => {
    const entries = registry.entries()
    return vault
      .list()
      .filter((m) => entries.get(m.id)?.deleted !== true)
      .map((m) => {
        const entry = entries.get(m.id)
        return entry !== undefined ? { id: m.id, title: entry.title } : m
      })
  }, [vault, registry])

  // Tombstoned notes still held locally (the "trash"): restorable, with their Markdown retained.
  const deletedList = useCallback((): NoteMeta[] => {
    const entries = registry.entries()
    return vault
      .list()
      .filter((m) => entries.get(m.id)?.deleted === true)
      .map((m) => {
        const entry = entries.get(m.id)
        return entry !== undefined ? { id: m.id, title: entry.title } : m
      })
  }, [vault, registry])

  // Workspace-level registry sync (the note LIST converges across peers). Keyed on the
  // workspace/sync inputs — NOT activeId — so switching notes never reconnects this socket.
  useEffect(() => {
    let disposed = false
    // Add-only reconcile: materialize every registry entry this replica lacks. It NEVER
    // removes a local note for being absent from a (possibly empty / un-hydrated) registry,
    // so remote state can't destroy local work.
    const reconcile = (): void => {
      if (disposed) return
      // Materialize live (non-tombstoned) registry notes this replica lacks. A tombstone for a
      // note we never had is ignored (don't resurrect a stranger's deleted note into our trash).
      for (const [id, entry] of registry.entries()) {
        if (id !== REGISTRY_ROOM && entry.deleted !== true) vault.ensure(asNoteId(id), entry.title)
      }
      const visible = unionList()
      setNotes(visible)
      setDeleted(deletedList())
      setGraph(computeGraph(vault))
      setTagIndex(computeTags(vault))
      // If the active note was just deleted (here or by a peer), move to the first visible note.
      // Its body was persisted on the body effect's cleanup, so nothing is lost and it restores.
      if (visible.length > 0 && !visible.some((m) => m.id === activeIdRef.current)) {
        const next = visible[0]
        if (next) setActiveId(next.id)
      }
    }
    const off = registry.subscribe(reconcile)

    let local: LocalDocPersistence | null = null
    let disconnect: (() => void) | null = null
    if (syncUrl !== undefined) {
      const room = `${workspaceId}/${REGISTRY_ROOM}`
      if (options.registryPersistence !== undefined) {
        local = options.registryPersistence(registry, room)
        void local.whenLoaded.then(() => {
          if (!disposed) reconcile()
        })
      }
      const connectRegistry = options.connectRegistry ?? connectRegistryToServer
      disconnect = connectRegistry(registry, {
        url: syncUrl,
        room,
        onHydrated: () => {
          if (!disposed) reconcile()
        },
      })
    }
    reconcile() // covers no-sync mode + any pre-existing registry state
    return () => {
      disposed = true
      off()
      disconnect?.()
      local?.destroy()
      // The registry doc is hook-lifetime; it is destroyed on unmount, not on this re-run.
    }
  }, [
    vault,
    registry,
    unionList,
    deletedList,
    syncUrl,
    workspaceId,
    options.connectRegistry,
    options.registryPersistence,
  ])

  // Destroy the hook-lifetime registry doc only on full unmount.
  useEffect(() => () => registryRef.current?.destroy(), [])

  useEffect(() => {
    const note = openYjsNote()
    const syncing = syncUrl !== undefined
    let disposed = false
    // In sync mode the CRDT (local cache + super-peer) is authoritative and the Markdown
    // vault is its offline-readable cache: never write an EMPTY doc back to the vault, or a
    // pre-sync doc, a fast note switch, or a brand-new empty room would clobber real Markdown.
    // (In no-sync mode the doc is seeded from the vault, so clearing a note to "" is a real edit.)
    const writableToVault = (): boolean => !syncing || note.getText() !== ""
    const persist = (): void => {
      if (!writableToVault()) return
      vault.write(activeId, note.getText())
      setGraph(computeGraph(vault))
      setTagIndex(computeTags(vault))
    }
    // "Hydrated" means edits may flow back to the vault. It flips once the authoritative
    // state has arrived (local cache loaded or server synced) — even if that state is empty,
    // in which case persist() simply no-ops until the first real content appears.
    let hydrated = false
    const markHydrated = (): void => {
      if (disposed || hydrated) return
      hydrated = true
      persist()
    }

    const connect = options.connect ?? connectNoteToServer
    let local: LocalDocPersistence | null = null
    let disconnect: (() => void) | null = null

    if (syncUrl !== undefined) {
      const room = `${workspaceId}/${activeId}`
      // A note this client just created: seed its body into the synced doc from the vault.
      // The id is a fresh UUID authored only here, so this is NOT the shared-seed double-seed
      // case — seeding makes the creator see their content and lets peers receive the body.
      if (pendingSeedRef.current.has(activeId)) {
        pendingSeedRef.current.delete(activeId)
        note.setText(vault.read(activeId), LOCAL)
        hydrated = true
      }
      // Offline-first for a synced room: load the last-synced state from local CRDT
      // persistence so the editor is readable with zero connectivity; the super-peer then
      // merges live edits on top of the same doc via CRDT. The empty-doc guard in persist()
      // means hydrating from an empty cache or an empty server room never clobbers the vault.
      if (options.localPersistence !== undefined) {
        local = options.localPersistence(note, room)
        void local.whenLoaded.then(() => {
          if (!disposed) markHydrated()
        })
      }
      // The super-peer is authoritative; it merges on top of any local cache via CRDT.
      disconnect = connect(note, { url: syncUrl, room, onHydrated: markHydrated })
    } else {
      note.setText(vault.read(activeId), LOCAL)
      hydrated = true
    }

    const off = note.subscribe(() => {
      if (hydrated) persist()
    })
    setActive({ id: activeId, note })
    setVersions(storeFor(activeId).list())
    setGraph(computeGraph(vault))
    setTagIndex(computeTags(vault))
    return () => {
      disposed = true
      off()
      if (hydrated && writableToVault()) vault.write(activeId, note.getText())
      disconnect?.()
      local?.destroy()
      note.destroy()
    }
  }, [activeId, vault, storeFor, syncUrl, workspaceId, options.connect, options.localPersistence])

  // Expose the active doc only when it matches the active id AND that note isn't tombstoned —
  // so deleting the last visible note (or a peer deleting the one you're on) can't leave an
  // editable editor bound to a trashed note. Restoring it (or selecting another) shows it again.
  const activeNote =
    active && active.id === activeId && registry.get(activeId)?.deleted !== true
      ? active.note
      : null

  const activeMeta = useMemo(() => notes.find((m) => m.id === activeId), [notes, activeId])
  const outgoing = useMemo<readonly string[]>(
    () => [...(graph.outgoing.get(activeId) ?? [])],
    [graph, activeId],
  )
  const backlinks = useMemo<readonly NoteMeta[]>(() => {
    if (activeMeta === undefined) return []
    const ids = graph.backlinks.get(activeMeta.title) ?? new Set<string>()
    return notes.filter((m) => ids.has(m.id))
  }, [graph, activeMeta, notes])

  // The active note's tags (from its frontmatter), and the visible notes carrying a given tag —
  // both derived from the workspace's own Markdown, so tag navigation can never cross workspaces.
  const tags = useMemo<readonly string[]>(
    () => tagIndex.byNote.get(activeId) ?? [],
    [tagIndex, activeId],
  )
  const notesForTag = useCallback(
    (tag: string): NoteMeta[] => {
      const ids = tagIndex.byTag.get(tag)
      return ids === undefined ? [] : notes.filter((m) => ids.has(m.id))
    },
    [tagIndex, notes],
  )

  const select = useCallback(
    (id: NoteId): void => {
      // Materialize a registry-only note (defensive) so the body effect's vault.read never
      // throws and its empty body rides the sync-mode empty-doc guard until the server fills it.
      if (!vault.list().some((m) => m.id === id)) {
        vault.ensure(id, registry.get(id)?.title ?? id)
      }
      setActiveId(id)
    },
    [vault, registry],
  )
  const selectByTitle = useCallback(
    (title: string): void => {
      const target = unionList().find((m) => m.title === title)
      if (target) setActiveId(target.id)
    },
    [unionList],
  )
  const create = useCallback(
    (title: string): void => {
      const meta = vault.create(title, `# ${title}\n`)
      pendingSeedRef.current.add(meta.id) // seed this note's body into its synced doc on open
      registry.set(meta.id, { title }, LOCAL) // propagate the list entry to peers
      setNotes(unionList())
      setActiveId(meta.id)
    },
    [vault, registry, unionList],
  )
  // Rename: change the display title AND atomically repoint every `[[old title]]` backlink across
  // the vault, so no dangling link is left behind (link integrity). The OPEN note's body change
  // rides the CRDT doc (synced, attributed, revertible like any edit); other notes are rewritten in
  // the vault, and the vault's own title metadata is kept in step. No-op on a blank, unchanged, or
  // already-taken (by another visible note) title.
  //
  // Bounds — fully correct local-first/single-writer; deferred edges are non-destructive: the title
  // is a registry-level edit reversible by renaming back (not part of per-note body history, like
  // delete/restore); and in sync mode a NON-OPEN note's body rewrite stays local until that room is
  // reopened, pending the multi-doc sync (S4c) that also governs concurrent same-note renames.
  const rename = (id: NoteId, rawTitle: string): void => {
    const newTitle = rawTitle.trim()
    if (newTitle === "") return
    const current = registry.get(id)
    const oldTitle = current?.title ?? vault.list().find((m) => m.id === id)?.title
    if (oldTitle === undefined || oldTitle === newTitle) return
    // Refuse a title already used by another visible note: wikilinks resolve by title, so a
    // duplicate makes `[[title]]` ambiguous — protect link integrity rather than corrupt it.
    // (Reusing a trashed note's title is fine — it's hidden.)
    if (unionList().some((m) => m.id !== id && m.title === newTitle)) return

    // Non-active notes: rewrite their Markdown directly in the vault. The active id is ALWAYS
    // handled via its doc below (never vault.write it — a doc still hydrating from the server
    // would clobber that write on sync), so skip it here unconditionally.
    for (const m of vault.list()) {
      if (m.id === activeId) continue
      const body = vault.read(m.id)
      const next = renameWikiLinkTargets(body, oldTitle, newTitle)
      if (next !== body) vault.write(m.id, next)
    }
    // The open note: rewrite through the CRDT doc so the edit is attributed, synced, and revertible.
    if (activeNote !== null) {
      const body = activeNote.getText()
      const next = renameWikiLinkTargets(body, oldTitle, newTitle)
      if (next !== body) activeNote.setText(next, LOCAL)
    }

    // Keep the vault's title metadata in step (the registry is the canonical title authority, but a
    // drifting vault title would feed a stale `oldTitle` to a later rename and stale names to the AI).
    vault.rename(id, newTitle)
    // Update the display title (last-writer-wins per id → converges to peers). Preserve a tombstone.
    const entry: RegistryEntry = current?.deleted
      ? { title: newTitle, deleted: true }
      : { title: newTitle }
    registry.set(id, entry, LOCAL)
    setNotes(unionList())
    setGraph(computeGraph(vault))
    setTagIndex(computeTags(vault))
  }
  // Delete = a revertible registry tombstone: it hides the note from the list across peers but
  // never erases its Markdown body (kept in the vault), so it can be restored and no human work
  // is silently destroyed. The reconcile fired by this set updates the list and, if this was the
  // active note, moves to the first visible one.
  const remove = useCallback(
    (id: NoteId): void => {
      const title = registry.get(id)?.title ?? vault.list().find((m) => m.id === id)?.title ?? id
      registry.set(id, { title, deleted: true }, LOCAL)
    },
    [registry, vault],
  )
  const restore = useCallback(
    (id: NoteId): void => {
      const title = registry.get(id)?.title ?? vault.list().find((m) => m.id === id)?.title ?? id
      registry.set(id, { title, deleted: false }, LOCAL)
    },
    [registry, vault],
  )

  const commit = (label?: string): void => {
    if (activeNote === null) return
    const store = storeFor(activeId)
    store.commit(activeNote, label !== undefined ? { origin: LOCAL, label } : { origin: LOCAL })
    setVersions(store.list())
  }
  const revert = (id: string): void => {
    if (activeNote === null) return
    const past = storeFor(activeId).open(id)
    try {
      activeNote.setText(past.getText(), LOCAL)
    } finally {
      past.destroy()
    }
  }
  const diffAgainstCurrent = (id: string): DiffChunk[] => {
    if (activeNote === null) return []
    const past = storeFor(activeId).open(id)
    try {
      return textDiff(past.getText(), activeNote.getText())
    } finally {
      past.destroy()
    }
  }
  const aiOrganize = async (session: Session): Promise<OnSaveResult> => {
    const ai = aiRef.current
    if (activeNote === null || ai === null || aiBusyRef.current) {
      return { links: [], tags: [], versionId: null, applied: false }
    }
    // Capture the target so a note switch during the (async) run can't redirect the write,
    // and guard against concurrent runs.
    const targetId = activeId
    const note = activeNote
    aiBusyRef.current = true
    setAiBusy(true)
    try {
      const meta = vault.list().find((m) => m.id === targetId)
      const others: NoteContext[] = vault
        .list()
        .filter((m) => m.id !== targetId)
        .map((m) => ({ id: m.id, title: m.title, body: vault.read(m.id) }))
      const result = await runOnSaveAgent(
        {
          session,
          workspaceId,
          noteId: targetId,
          title: meta?.title ?? targetId,
          note,
          store: storeFor(targetId),
          index: ai.index,
          others,
        },
        { suggester: ai.suggester, embedder: ai.embedder },
      )
      // Persist directly to the vault: if the user switched notes mid-run, the note's own
      // subscribe-writer was torn down, so don't depend on it — keep Markdown the source of
      // truth, consistent with the committed AI version.
      vault.write(targetId, note.getText())
      setGraph(computeGraph(vault))
      setTagIndex(computeTags(vault))
      // Only refresh the history panel if this note is still the active one.
      if (activeIdRef.current === targetId) setVersions(storeFor(targetId).list())
      return result
    } finally {
      aiBusyRef.current = false
      setAiBusy(false)
    }
  }
  const aiAsk = async (query: string): Promise<RagAnswer> => {
    const ai = aiRef.current
    if (ai === null || query.trim() === "") return { answer: "", citations: [] }
    // Keep the derived index current with the Markdown (idempotent), then retrieve + answer.
    await reindexWorkspace({ vault, index: ai.index, embedder: ai.embedder })
    const chunks = await ai.retriever.retrieve({ text: query, k: 5 })
    return ai.answerer.answer(query, chunks)
  }

  return {
    notes,
    activeId,
    activeNote,
    outgoing,
    backlinks,
    tags,
    notesForTag,
    versions,
    deleted,
    select,
    selectByTitle,
    create,
    rename,
    remove,
    restore,
    commit,
    revert,
    diffAgainstCurrent,
    aiOrganize,
    aiBusy,
    aiAsk,
  }
}
