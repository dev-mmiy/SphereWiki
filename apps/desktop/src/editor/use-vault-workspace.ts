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
  buildLinkGraph,
  createMemoryVault,
  createMemoryVersionStore,
  type DiffChunk,
  type EditOrigin,
  type LinkGraph,
  type NoteId,
  type NoteMeta,
  openYjsNote,
  parseNote,
  type Session,
  textDiff,
  type Vault,
  type Version,
  type VersionStore,
  type WorkspaceId,
  type YjsBackedNote,
  yjsEngine,
} from "@spherewiki/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { WORKSPACE_ID } from "../auth-dev"
import { type ConnectNote, connectNoteToServer } from "../sync/connect-server"
import type { ConnectLocalPersistence, LocalDocPersistence } from "../sync/local-persistence"
import { createLocalStorageVault } from "../vault/local-vault"

const LOCAL: EditOrigin = { actor: "local", kind: "human" }

const SEED: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Home", body: "# Home\n\nWelcome. See [[Getting Started]] and [[Ideas]].\n" },
  { title: "Getting Started", body: "# Getting Started\n\nBack to [[Home]].\n" },
  { title: "Ideas", body: "# Ideas\n\n- AI auto-links notes\n- See [[Home]]\n" },
]

function computeGraph(vault: Vault): LinkGraph {
  return buildLinkGraph(vault.list().map((m) => ({ id: m.id, body: vault.read(m.id) })))
}

export interface VaultWorkspace {
  readonly notes: readonly NoteMeta[]
  readonly activeId: NoteId
  readonly activeNote: YjsBackedNote | null
  readonly outgoing: readonly string[]
  readonly backlinks: readonly NoteMeta[]
  readonly versions: readonly Version[]
  select: (id: NoteId) => void
  selectByTitle: (title: string) => void
  create: (title: string) => void
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
  /** When set, the vault is durably persisted to localStorage under this key (survives reload). */
  readonly persistVaultKey?: string
  /** Storage backend for the durable vault; defaults to window.localStorage (injectable for tests). */
  readonly vaultStorage?: Pick<Storage, "getItem" | "setItem">
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
          })
        : createMemoryVault(SEED)
  }
  const vault = vaultRef.current

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
  const [versions, setVersions] = useState<readonly Version[]>([])
  const [aiBusy, setAiBusy] = useState(false)

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
    return () => {
      disposed = true
      off()
      if (hydrated && writableToVault()) vault.write(activeId, note.getText())
      disconnect?.()
      local?.destroy()
      note.destroy()
    }
  }, [activeId, vault, storeFor, syncUrl, workspaceId, options.connect, options.localPersistence])

  const activeNote = active && active.id === activeId ? active.note : null
  // Track the live active id so an in-flight AI run can tell if the user has switched away.
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

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

  const select = useCallback((id: NoteId): void => setActiveId(id), [])
  const selectByTitle = useCallback(
    (title: string): void => {
      const target = vault.list().find((m) => m.title === title)
      if (target) setActiveId(target.id)
    },
    [vault],
  )
  const create = useCallback(
    (title: string): void => {
      const meta = vault.create(title, `# ${title}\n`)
      setNotes(vault.list())
      setActiveId(meta.id)
    },
    [vault],
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
    versions,
    select,
    selectByTitle,
    create,
    commit,
    revert,
    diffAgainstCurrent,
    aiOrganize,
    aiBusy,
    aiAsk,
  }
}
