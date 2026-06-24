import {
  createMemoryVersionStore,
  type DiffChunk,
  type EditOrigin,
  openYjsNote,
  textDiff,
  type Version,
  type VersionStore,
  type YjsBackedNote,
  yjsEngine,
} from "@spherewiki/shared"
import { useEffect, useRef, useState } from "react"

const LOCAL: EditOrigin = { actor: "local", kind: "human" }

export interface NoteSession {
  readonly note: YjsBackedNote
  readonly versions: readonly Version[]
  commit: (origin: EditOrigin, label?: string) => void
  revert: (id: string, origin: EditOrigin) => void
  diffAgainstCurrent: (id: string) => DiffChunk[]
}

/** Owns one note's CRDT doc + its version store for the lifetime of the component. */
export function useNoteSession(initial?: string): NoteSession {
  const ref = useRef<{ note: YjsBackedNote; store: VersionStore } | null>(null)
  if (ref.current === null) {
    const note = openYjsNote()
    if (initial !== undefined) note.setText(initial, LOCAL)
    ref.current = { note, store: createMemoryVersionStore(yjsEngine) }
  }
  const { note, store } = ref.current

  const [versions, setVersions] = useState<readonly Version[]>([])

  useEffect(() => () => note.destroy(), [note])

  const commit = (origin: EditOrigin, label?: string): void => {
    store.commit(note, label !== undefined ? { origin, label } : { origin })
    setVersions(store.list())
  }

  const revert = (id: string, origin: EditOrigin): void => {
    const past = store.open(id)
    try {
      note.setText(past.getText(), origin)
    } finally {
      past.destroy()
    }
  }

  const diffAgainstCurrent = (id: string): DiffChunk[] => {
    const past = store.open(id)
    try {
      return textDiff(past.getText(), note.getText())
    } finally {
      past.destroy()
    }
  }

  return { note, versions, commit, revert, diffAgainstCurrent }
}
