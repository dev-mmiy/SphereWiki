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
  textDiff,
  type Vault,
  type Version,
  type VersionStore,
  type YjsBackedNote,
  yjsEngine,
} from "@spherewiki/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
}

/**
 * Owns the in-memory vault, the active note's CRDT doc (recreated on switch,
 * seeded from the vault and writing edits back), per-note version stores, and
 * the derived link graph. The active note is exposed only when it matches the
 * active id, so consumers never bind to a stale doc during a switch.
 */
export function useVaultWorkspace(): VaultWorkspace {
  const vaultRef = useRef<Vault | null>(null)
  if (vaultRef.current === null) vaultRef.current = createMemoryVault(SEED)
  const vault = vaultRef.current

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

  useEffect(() => {
    const note = openYjsNote()
    note.setText(vault.read(activeId), LOCAL)
    const off = note.subscribe(() => {
      vault.write(activeId, note.getText())
      setGraph(computeGraph(vault))
    })
    setActive({ id: activeId, note })
    setVersions(storeFor(activeId).list())
    setGraph(computeGraph(vault))
    return () => {
      off()
      vault.write(activeId, note.getText())
      note.destroy()
    }
  }, [activeId, vault, storeFor])

  const activeNote = active && active.id === activeId ? active.note : null

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
  }
}
