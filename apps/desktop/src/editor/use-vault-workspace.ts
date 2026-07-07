import {
  type Answerer,
  type Autonomy,
  createExtractiveAnswerer,
  createHeuristicSuggester,
  createLocalEmbedder,
  createMemoryVectorIndex,
  createRagRetriever,
  type EmbeddingProvider,
  type LinkSuggestion,
  type NoteContext,
  type OnSaveResult,
  type RagAnswer,
  type RagRetriever,
  reindexWorkspace,
  runOnSaveAgent,
  type SuggestionProvider,
  type TagSuggestion,
  type VectorIndex,
} from "@spherewiki/ai"
import {
  addNoteTag,
  asNoteId,
  buildGraphModel,
  buildLinkGraph,
  buildSearchIndex,
  buildTagIndex,
  buildWorkspaceMetrics,
  countAiVersionsAfter,
  createMemoryVault,
  createMemoryVersionStore,
  type DiffChunk,
  type EditOrigin,
  type GraphModel,
  type LinkGraph,
  type NoteId,
  type NoteMeta,
  openYjsNote,
  openYjsRegistry,
  parseNote,
  type RegistryEntry,
  removeNoteTag,
  renameWikiLinkTargets,
  type SearchHit,
  type Session,
  searchNotes,
  type TagIndex,
  textDiff,
  upsertFrontmatter,
  type Vault,
  type Version,
  type VersionStore,
  type WorkspaceId,
  type WorkspaceMetrics,
  type YjsBackedNote,
  type YjsBackedRegistry,
  yjsEngine,
} from "@spherewiki/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { WORKSPACE_ID } from "../auth-local"
import {
  type AiEditMetrics,
  type AiMetricsRecorder,
  createAiMetricsRecorder,
} from "../metrics/ai-metrics"
import { createSessionPrefs, type SessionPrefsStore } from "../session/session-prefs"
import { type ConnectRegistry, connectRegistryToServer } from "../sync/connect-registry"
import { type ConnectNote, connectNoteToServer } from "../sync/connect-server"
import type { ConnectLocalPersistence, LocalDocPersistence } from "../sync/local-persistence"
import type { ConnectRegistryPersistence } from "../sync/registry-persistence"
import { createLocalStorageVault } from "../vault/local-vault"
import { createLocalStorageVersionStore } from "../version/local-version-store"

/** The reserved registry room id; note ids are UUIDs and can never equal it. */
const REGISTRY_ROOM = "__registry__"

const LOCAL: EditOrigin = { actor: "local", kind: "human" }

/** The first-run seed notes. Exported so a pre-hydrated injected vault (the Tauri file vault) can
 * seed with the exact same content the in-memory / localStorage vaults use. */
export const SEED: ReadonlyArray<{ title: string; body: string }> = [
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

/** One outgoing `[[wikilink]]` from the active note, with whether its target note exists. */
export interface OutgoingLink {
  readonly title: string
  /** True when a visible note carries this title; false for a dangling ("red") link. */
  readonly exists: boolean
}

/**
 * The active note's sync state for the UI: `local` (no sync configured — offline-first by
 * default), `syncing` (a synced room awaiting its first authoritative state), or `synced`
 * (state has loaded; edits flow to peers / the super-peer).
 */
export type SyncState = "local" | "syncing" | "synced"

export interface VaultWorkspace {
  readonly notes: readonly NoteMeta[]
  readonly activeId: NoteId
  readonly activeNote: YjsBackedNote | null
  /** True once the active note's authoritative state has loaded (always true in no-sync mode). */
  readonly hydrated: boolean
  /** Coarse sync state for the active note, for a status indicator. */
  readonly syncStatus: SyncState
  readonly outgoing: readonly OutgoingLink[]
  readonly backlinks: readonly NoteMeta[]
  /** Node/edge model of the whole workspace's notes and their wikilinks — the basic graph view. */
  readonly graph: GraphModel
  /** Derived graph-growth metrics (notes / links / frontier / tags) for the dogfooding readout. */
  readonly metrics: WorkspaceMetrics
  /** The active note's tags, read from its frontmatter (derived from Markdown). */
  readonly tags: readonly string[]
  /** Visible notes carrying a given tag — for tag-based navigation (workspace-scoped). */
  notesForTag: (tag: string) => readonly NoteMeta[]
  /** Add a tag to the active note's frontmatter (a human edit, via the CRDT doc; revertible). */
  addTag: (tag: string) => void
  /** Remove a tag from the active note's frontmatter (via the CRDT doc; revertible). */
  removeTag: (tag: string) => void
  /** Full-text search over the visible notes (title + body + tags); ranked, workspace-scoped. */
  search: (query: string) => readonly SearchHit[]
  readonly versions: readonly Version[]
  /** Tombstoned notes still recoverable locally (the "trash"). */
  readonly deleted: readonly NoteMeta[]
  select: (id: NoteId) => void
  selectByTitle: (title: string) => void
  /** Create a note (resolve-or-restore on a duplicate title). Pass `folder` to mint it inside a
   * folder (needs `canMove`; ignored on a vault without folders). */
  create: (title: string, folder?: string) => void
  /**
   * Rename a note: update its display title (the registry is the title authority and converges
   * to peers via last-writer-wins) and atomically repoint every `[[old title]]` backlink across
   * the vault, so no dangling link is left behind. The open note's body change rides the CRDT
   * doc, so it syncs and is revertible like any body edit. No-op on a blank, unchanged, or
   * already-taken (by another visible note) title. The title itself is reversed by renaming back
   * — it is a registry-level edit, not part of per-note body history (like delete/restore).
   */
  rename: (id: NoteId, title: string) => void
  /** Move a note into another folder (`""` = root); organizational only — links/graph are unaffected.
   * No-op unless the vault supports folders (`canMove`). */
  move: (id: NoteId, folder: string) => void
  /** Whether the active vault supports folders (the on-disk file vault does; localStorage does not) —
   * gate the sidebar's "move" affordance on it. */
  canMove: boolean
  /** Soft-delete a note: hidden from the list across peers, body retained, revertible. */
  remove: (id: NoteId) => void
  /** Restore a soft-deleted note. */
  restore: (id: NoteId) => void
  commit: (label?: string) => void
  revert: (id: string) => void
  diffAgainstCurrent: (id: string) => DiffChunk[]
  /** Run the on-save AI agent on the active note; AI edits land as attributed, revertible versions. */
  aiOrganize: (session: Session) => Promise<OnSaveResult>
  /** Apply a human-confirmed subset of suggestions (suggest-mode accept) via the same AI write path. */
  aiApplySuggestions: (
    session: Session,
    selection: { links: readonly string[]; tags: readonly string[] },
  ) => Promise<OnSaveResult>
  /** The workspace's AI autonomy: `off` / `suggest` (review-before-apply) / `auto`. */
  readonly aiAutonomy: Autonomy
  setAiAutonomy: (autonomy: Autonomy) => void
  /** True while an AI run is in flight (so the UI can prevent concurrent runs). */
  readonly aiBusy: boolean
  /** Accumulated kept-vs-reverted counters for the AI agent's edits (the M5 dogfooding signal). */
  readonly aiMetrics: AiEditMetrics
  /** RAG question-answering scoped to this workspace; returns a cited answer. */
  aiAsk: (query: string) => Promise<RagAnswer>
}

export interface UseVaultWorkspaceOptions {
  readonly workspaceId?: WorkspaceId
  /**
   * Inject a pre-built, already-hydrated Vault (the on-disk Tauri file vault under the native shell;
   * see `createTauriVault`). Takes precedence over `persistVaultKey`; when omitted the hook builds a
   * localStorage vault (web) or an in-memory one (tests). Must be hydrated before injection so its
   * `list()`/`read()` are synchronously ready — the hook treats it exactly like the built-in vaults.
   */
  readonly vault?: Vault
  /** Inject AI providers (the real Claude/ONNX backends at M4b; deterministic stubs in tests). */
  readonly suggester?: SuggestionProvider
  readonly embedder?: EmbeddingProvider
  /**
   * Inject a pre-built, already-hydrated per-workspace VectorIndex (the on-disk DuckDB index under
   * the native shell; see `createTauriVectorIndex`). Must use the same `embedder`'s model. When
   * omitted the hook builds an in-memory index (web / tests).
   */
  readonly index?: VectorIndex
  /** When set, the active note syncs live through the super-peer at this WebSocket URL. */
  readonly syncUrl?: string
  /**
   * Auth token presented when joining synced rooms (note bodies AND the registry), verified
   * by the server's RoomAuthorizer. Only meaningful with `syncUrl`; omitted → open rooms
   * (the local default). Inert until a token issuer (WorkOS) lands — this readies the seam.
   */
  readonly syncToken?: string
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
  /**
   * When set, each note's version history persists to localStorage under `${key}:${noteId}` (so
   * revert/diff points survive a reload). Uses `vaultStorage` as its backend when provided.
   */
  readonly persistVersionsKey?: string
  /**
   * When set, session UX prefs (last active note + AI autonomy mode) persist to localStorage under
   * this key, so a reload resumes where you left off. Uses `vaultStorage` as its backend.
   */
  readonly persistSessionKey?: string
  /** Storage backend for the durable vault; defaults to window.localStorage (injectable for tests). */
  readonly vaultStorage?: Pick<Storage, "getItem" | "setItem">
  /** Note-id generator threaded into the durable vault (injectable for deterministic tests). */
  readonly newNoteId?: () => string
  /** Kept-vs-reverted recorder (localStorage-backed in the app; an in-memory fake in tests). */
  readonly aiMetricsRecorder?: AiMetricsRecorder
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
  const syncToken = options.syncToken
  const vaultRef = useRef<Vault | null>(null)
  if (vaultRef.current === null) {
    vaultRef.current =
      // An injected, already-hydrated vault (the on-disk Tauri file vault) wins; else the durable
      // localStorage vault (web) or an in-memory one (tests).
      options.vault ??
      (options.persistVaultKey !== undefined
        ? createLocalStorageVault(SEED, {
            key: options.persistVaultKey,
            ...(options.vaultStorage !== undefined ? { storage: options.vaultStorage } : {}),
            ...(options.newNoteId !== undefined ? { newId: options.newNoteId } : {}),
          })
        : createMemoryVault(
            SEED,
            options.newNoteId !== undefined ? { newId: options.newNoteId } : {},
          ))
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
    // An injected, already-hydrated index (the on-disk DuckDB store under Tauri) wins; else in-memory.
    const index = options.index ?? createMemoryVectorIndex(workspaceId, embedder.info)
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

  // Kept-vs-reverted recorder (the M5 dogfooding signal): accumulates the agent's applied vs
  // reverted edit batches. Injected (localStorage-backed) by the app; an in-memory default in tests.
  const aiMetricsRef = useRef<AiMetricsRecorder | null>(null)
  if (aiMetricsRef.current === null) {
    aiMetricsRef.current = options.aiMetricsRecorder ?? createAiMetricsRecorder()
  }
  const aiMetricsRecorder = aiMetricsRef.current

  const storesRef = useRef(new Map<NoteId, VersionStore>())
  // A note's version history persists locally when `persistVersionsKey` is set (so revert/diff
  // points survive a reload), keyed per note; otherwise it's in-memory (tests / no-persistence).
  const persistVersionsKey = options.persistVersionsKey
  const vaultStorage = options.vaultStorage
  const storeFor = useCallback(
    (id: NoteId): VersionStore => {
      const stores = storesRef.current
      let store = stores.get(id)
      if (store === undefined) {
        store =
          persistVersionsKey !== undefined
            ? createLocalStorageVersionStore(yjsEngine, {
                key: `${persistVersionsKey}:${id}`,
                ...(vaultStorage !== undefined ? { storage: vaultStorage } : {}),
              })
            : createMemoryVersionStore(yjsEngine)
        stores.set(id, store)
      }
      return store
    },
    [persistVersionsKey, vaultStorage],
  )

  // Durable session UX prefs (last active note + AI mode), so a reload resumes where you left off.
  const sessionPrefsRef = useRef<SessionPrefsStore | null>(null)
  if (sessionPrefsRef.current === null && options.persistSessionKey !== undefined) {
    sessionPrefsRef.current = createSessionPrefs({
      key: options.persistSessionKey,
      ...(options.vaultStorage !== undefined ? { storage: options.vaultStorage } : {}),
    })
  }
  const sessionPrefs = sessionPrefsRef.current

  const [notes, setNotes] = useState<readonly NoteMeta[]>(() => vault.list())
  const [activeId, setActiveId] = useState<NoteId>(() => {
    const list = vault.list()
    const first = list[0]
    if (first === undefined) throw new Error("vault must seed at least one note")
    // Resume the last active note if it still exists (a tombstoned one is corrected by reconcile).
    const stored = sessionPrefs?.read().activeId
    return stored !== undefined && list.some((m) => m.id === stored) ? asNoteId(stored) : first.id
  })
  const [active, setActive] = useState<{ id: NoteId; note: YjsBackedNote } | null>(null)
  // True once the active note's authoritative state has loaded. In no-sync mode it flips
  // synchronously (the doc is seeded from the vault); in sync mode it waits for the local cache
  // or super-peer, so edits made in that window can't write into a doc the server body will later
  // merge AFTER (which would push frontmatter out of line 0 and corrupt the note).
  const [hydrated, setHydrated] = useState(false)
  const [graph, setGraph] = useState<LinkGraph>(() => computeGraph(vault))
  // The tag index mirrors `graph`: both are derived from the vault's Markdown and recomputed
  // imperatively in lockstep on every body change (a memo can't observe non-state body edits).
  const [tagIndex, setTagIndex] = useState<TagIndex>(() => computeTags(vault))
  const [versions, setVersions] = useState<readonly Version[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMetrics, setAiMetrics] = useState<AiEditMetrics>(() => aiMetricsRecorder.snapshot())
  const [aiAutonomy, setAiAutonomy] = useState<Autonomy>(
    () => sessionPrefs?.read().aiAutonomy ?? "auto",
  )
  const [deleted, setDeleted] = useState<readonly NoteMeta[]>([])

  // Live active id, read by callbacks that outlive a render: an in-flight AI run (to tell if the
  // user switched away) and the registry reconcile (to move off a note a peer just deleted).
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // Persist session UX prefs as they change (no-op when no session key is configured). Effects so
  // every path that moves the active note / changes the mode is captured, not just the callbacks.
  useEffect(() => {
    sessionPrefs?.write({ activeId })
  }, [activeId, sessionPrefs])
  useEffect(() => {
    sessionPrefs?.write({ aiAutonomy })
  }, [aiAutonomy, sessionPrefs])

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
        // Registry title (LWW) wins, but keep the vault's `path` so the sidebar tree survives sync.
        return entry !== undefined ? { ...m, title: entry.title } : m
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
        // Registry title (LWW) wins, but keep the vault's `path` so the sidebar tree survives sync.
        return entry !== undefined ? { ...m, title: entry.title } : m
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
    const room = `${workspaceId}/${REGISTRY_ROOM}`
    // Persist the note registry locally whenever a persistence seam is provided — independent of
    // syncUrl. This is what makes the trash survive a reload offline: soft-delete is a registry
    // TOMBSTONE (never a vault delete), so without persisting the registry, a deleted note would
    // reappear after reload. The app always provides this; the bodies are already durable in the
    // localStorage vault, so the registry (list + tombstones + remote-origin titles) is the piece
    // that also needs a local store. Loading it triggers a reconcile so the trash is applied.
    if (options.registryPersistence !== undefined) {
      local = options.registryPersistence(registry, room)
      void local.whenLoaded.then(() => {
        if (!disposed) reconcile()
      })
    }
    if (syncUrl !== undefined) {
      const connectRegistry = options.connectRegistry ?? connectRegistryToServer
      disconnect = connectRegistry(registry, {
        url: syncUrl,
        room,
        ...(syncToken !== undefined ? { token: syncToken } : {}),
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
    syncToken,
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
    setHydrated(false) // reset for this note; flips true below once authoritative state loads
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
    const becomeHydrated = (): void => {
      hydrated = true
      if (!disposed) setHydrated(true) // mirror to state so the UI/edit guards can gate on it
    }
    const markHydrated = (): void => {
      if (disposed || hydrated) return
      becomeHydrated()
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
        becomeHydrated()
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
      disconnect = connect(note, {
        url: syncUrl,
        room,
        ...(syncToken !== undefined ? { token: syncToken } : {}),
        onHydrated: markHydrated,
      })
    } else {
      note.setText(vault.read(activeId), LOCAL)
      becomeHydrated()
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
  }, [
    activeId,
    vault,
    storeFor,
    syncUrl,
    syncToken,
    workspaceId,
    options.connect,
    options.localPersistence,
  ])

  // Expose the active doc only when it matches the active id AND that note isn't tombstoned —
  // so deleting the last visible note (or a peer deleting the one you're on) can't leave an
  // editable editor bound to a trashed note. Restoring it (or selecting another) shows it again.
  const activeNote =
    active && active.id === activeId && registry.get(activeId)?.deleted !== true
      ? active.note
      : null

  const activeMeta = useMemo(() => notes.find((m) => m.id === activeId), [notes, activeId])
  // The active note's outgoing links, each flagged as resolved or dangling (a `[[red link]]`
  // whose target note doesn't exist yet) so the UI can offer to create the missing note.
  const outgoing = useMemo<readonly OutgoingLink[]>(() => {
    const titles = graph.outgoing.get(activeId) ?? new Set<string>()
    const existing = new Set(notes.map((m) => m.title))
    return [...titles].map((title) => ({ title, exists: existing.has(title) }))
  }, [graph, activeId, notes])
  const backlinks = useMemo<readonly NoteMeta[]>(() => {
    if (activeMeta === undefined) return []
    const ids = graph.backlinks.get(activeMeta.title) ?? new Set<string>()
    return notes.filter((m) => ids.has(m.id))
  }, [graph, activeMeta, notes])

  // The whole-workspace graph model (nodes = visible notes, edges = resolved wikilinks),
  // derived from the same link graph + note list so it tracks every body/title change.
  const graphModel = useMemo<GraphModel>(
    () => buildGraphModel(notes, graph, { includeDangling: true }),
    [notes, graph],
  )
  // Workspace metrics (graph growth: notes / links / frontier / tags) — the dogfooding signal,
  // derived from the same graph model + tag index, so it tracks every body/title/tag change.
  const metrics = useMemo<WorkspaceMetrics>(
    () => buildWorkspaceMetrics(graphModel, tagIndex),
    [graphModel, tagIndex],
  )

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

  // Human tag curation: edit the active note's frontmatter through its CRDT doc, so the change
  // is attributed, synced, and revertible like any body edit — and the note's subscribe-writer
  // recomputes the tag index, so the panel updates. People and AI co-edit the same tags.
  // Guard on `hydrated`: editing the frontmatter of a not-yet-hydrated synced doc would write a
  // tags block the server body later merges after, corrupting the note — so no-op until ready.
  const addTag = useCallback(
    (tag: string): void => {
      if (activeNote === null || !hydrated) return
      const body = activeNote.getText()
      const next = addNoteTag(body, tag)
      if (next !== body) activeNote.setText(next, LOCAL)
    },
    [activeNote, hydrated],
  )
  const removeTag = useCallback(
    (tag: string): void => {
      if (activeNote === null || !hydrated) return
      const body = activeNote.getText()
      const next = removeNoteTag(body, tag)
      if (next !== body) activeNote.setText(next, LOCAL)
    },
    [activeNote, hydrated],
  )

  // Full-text search. Built on demand over the *visible* notes only (so trashed notes never
  // surface and a search can't cross workspaces), straight from the Markdown — the deterministic
  // rebuild entrypoint the idempotency invariant relies on. Cheap at MVP scale; DuckDB FTS
  // replaces the in-memory index at M2b behind the same `buildSearchIndex`/`searchNotes` seam.
  const search = useCallback(
    (query: string): readonly SearchHit[] => {
      if (query.trim() === "") return []
      const index = buildSearchIndex(
        notes.map((m) => ({ id: m.id, title: m.title, body: vault.read(m.id) })),
      )
      return searchNotes(index, query)
    },
    [notes, vault],
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
    (title: string, folder = ""): void => {
      // Resolve-or-restore: never mint a duplicate of a note that already holds this title.
      // A visible note -> just select it. A *trashed* note -> restore it (recovering its real
      // body) rather than minting a blank duplicate, so a ghost/red-link click can't orphan a
      // tombstoned note or break the title-uniqueness link-integrity invariant.
      const visible = unionList().find((m) => m.title === title)
      if (visible) {
        setActiveId(visible.id)
        return
      }
      const trashed = deletedList().find((m) => m.title === title)
      if (trashed) {
        registry.set(trashed.id, { title: trashed.title }, LOCAL) // un-tombstone (deleted omitted)
        vault.restore?.(trashed.id) // move the `.md` back out of `.trash/` — mirror the explicit restore()
        setNotes(unionList())
        setDeleted(deletedList())
        setActiveId(trashed.id)
        return
      }
      const meta = vault.create(title, `# ${title}\n`)
      // Create-in-folder: mint at root then relocate to the requested folder (both are synchronous
      // mirror updates, so the sidebar shows it in the folder at once; on disk the queued write +
      // rename land it there). No-op folder ("") / a vault without folders keeps it at the root.
      if (folder !== "") vault.move?.(meta.id, folder)
      pendingSeedRef.current.add(meta.id) // seed this note's body into its synced doc on open
      registry.set(meta.id, { title }, LOCAL) // propagate the list entry to peers
      setNotes(unionList())
      setActiveId(meta.id)
    },
    [vault, registry, unionList, deletedList],
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
      let next = renameWikiLinkTargets(body, oldTitle, newTitle)
      // If the OPEN note is the one being renamed AND its Markdown carries the title in frontmatter
      // (the on-disk file-vault convention), update that frontmatter title in the doc too. Otherwise
      // the doc-persist (which writes the whole `.md` source back for the file vault) would revert
      // `vault.rename`'s title change on disk, diverging Markdown from the registry. For a bare-body
      // note (localStorage — title is separate metadata) `frontmatter.title` is absent, so this is
      // skipped and no frontmatter is ever added.
      if (activeId === id && parseNote(next).frontmatter.title !== undefined) {
        next = upsertFrontmatter(next, { title: newTitle })
      }
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

  // Move a note into another folder (`""` = root). Purely organizational: the `.md` relocates but the
  // id/title/body — and so every `[[wikilink]]`, backlink, and graph edge — are unchanged, so only the
  // note list (the sidebar tree) needs refreshing. No-op unless the vault supports folders.
  const canMove = vault.move !== undefined
  const move = (id: NoteId, folder: string): void => {
    if (vault.move === undefined) return
    vault.move(id, folder)
    setNotes(unionList())
  }
  // Delete = a revertible registry tombstone: it hides the note from the list across peers but
  // never erases its Markdown body (kept in the vault), so it can be restored and no human work
  // is silently destroyed. The reconcile fired by this set updates the list and, if this was the
  // active note, moves to the first visible one.
  const remove = useCallback(
    (id: NoteId): void => {
      const title = registry.get(id)?.title ?? vault.list().find((m) => m.id === id)?.title ?? id
      registry.set(id, { title, deleted: true }, LOCAL)
      // On-disk vaults also move the `.md` into `.trash/` (O2) so a Markdown-only `reindex` prunes
      // its derived vector; a no-op for the in-memory/localStorage vaults (body retained in place).
      vault.trash?.(id)
    },
    [registry, vault],
  )
  const restore = useCallback(
    (id: NoteId): void => {
      const title = registry.get(id)?.title ?? vault.list().find((m) => m.id === id)?.title ?? id
      registry.set(id, { title, deleted: false }, LOCAL)
      vault.restore?.(id)
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
    const store = storeFor(activeId)
    // Kept-vs-reverted signal: reverting to `id` rolls back the AI versions committed after it.
    const undoneAi = countAiVersionsAfter(store.list(), id)
    if (undoneAi > 0) {
      aiMetricsRecorder.recordRevert(undoneAi)
      setAiMetrics(aiMetricsRecorder.snapshot())
    }
    const past = store.open(id)
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
  const runAgentOnActive = async (
    session: Session,
    opts: { autonomy: Autonomy; suggester?: SuggestionProvider },
  ): Promise<OnSaveResult> => {
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
          autonomy: opts.autonomy,
        },
        { suggester: opts.suggester ?? ai.suggester, embedder: ai.embedder },
      )
      // Persist directly to the vault: if the user switched notes mid-run, the note's own
      // subscribe-writer was torn down, so don't depend on it — keep Markdown the source of
      // truth, consistent with the committed AI version.
      vault.write(targetId, note.getText())
      setGraph(computeGraph(vault))
      setTagIndex(computeTags(vault))
      // Record the applied AI edit batch for the kept-vs-reverted signal.
      if (result.applied) {
        aiMetricsRecorder.recordApply({ links: result.links.length, tags: result.tags.length })
        setAiMetrics(aiMetricsRecorder.snapshot())
      }
      // Only refresh the history panel if this note is still the active one.
      if (activeIdRef.current === targetId) setVersions(storeFor(targetId).list())
      return result
    } finally {
      aiBusyRef.current = false
      setAiBusy(false)
    }
  }
  // Run the agent at the workspace's current autonomy: `auto` applies, `suggest` only surfaces
  // candidates (in `result.suggested`), `off` does nothing.
  const aiOrganize = (session: Session): Promise<OnSaveResult> =>
    runAgentOnActive(session, { autonomy: aiAutonomy })
  // Apply a human-confirmed subset of suggestions. A one-shot suggester returns exactly the
  // selection, then the agent runs in `auto` so the edit lands through the SAME attributed,
  // revertible write path as on-save (no second, divergent apply path to keep correct).
  const aiApplySuggestions = (
    session: Session,
    selection: { links: readonly string[]; tags: readonly string[] },
  ): Promise<OnSaveResult> => {
    const idForTitle = (title: string): NoteId =>
      vault.list().find((m) => m.title === title)?.id ?? asNoteId(title)
    const suggester: SuggestionProvider = {
      suggest: async () => ({
        links: selection.links.map(
          (title): LinkSuggestion => ({ kind: "link", title, targetId: idForTitle(title) }),
        ),
        tags: selection.tags.map((tag): TagSuggestion => ({ kind: "tag", tag })),
      }),
    }
    return runAgentOnActive(session, { autonomy: "auto", suggester })
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
    hydrated,
    // No sync configured → "local"; a synced room shows "syncing" until its state hydrates.
    syncStatus: syncUrl === undefined ? "local" : hydrated ? "synced" : "syncing",
    outgoing,
    backlinks,
    graph: graphModel,
    metrics,
    tags,
    notesForTag,
    addTag,
    removeTag,
    search,
    versions,
    deleted,
    select,
    selectByTitle,
    create,
    rename,
    move,
    canMove,
    remove,
    restore,
    commit,
    revert,
    diffAgainstCurrent,
    aiOrganize,
    aiApplySuggestions,
    aiAutonomy,
    setAiAutonomy,
    aiBusy,
    aiMetrics,
    aiAsk,
  }
}
