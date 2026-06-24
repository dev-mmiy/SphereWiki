import * as Y from "yjs"
import type {
  CrdtEngine,
  CrdtNote,
  CrdtSnapshot,
  CrdtTextEvent,
  CrdtUpdate,
  EditOrigin,
} from "./types"

/** The only file in the codebase that imports a concrete CRDT engine. */

const TEXT_KEY = "body"

function isEditOrigin(value: unknown): value is EditOrigin {
  return typeof value === "object" && value !== null && "actor" in value && "kind" in value
}

/** Minimal replace span: shared prefix/suffix are left untouched (merge-friendly). */
function diffSpan(current: string, next: string): { at: number; remove: number; insert: string } {
  const max = Math.min(current.length, next.length)
  let prefix = 0
  while (prefix < max && current[prefix] === next[prefix]) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++
  }
  return {
    at: prefix,
    remove: current.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  }
}

class YjsNote implements CrdtNote {
  readonly #doc: Y.Doc
  readonly #text: Y.Text

  constructor(doc: Y.Doc) {
    this.#doc = doc
    this.#text = doc.getText(TEXT_KEY)
  }

  getText(): string {
    return this.#text.toString()
  }

  setText(next: string, origin: EditOrigin): void {
    const current = this.#text.toString()
    if (current === next) return
    const { at, remove, insert } = diffSpan(current, next)
    this.#doc.transact(() => {
      if (remove > 0) this.#text.delete(at, remove)
      if (insert.length > 0) this.#text.insert(at, insert)
    }, origin)
  }

  applyUpdate(update: CrdtUpdate): void {
    Y.applyUpdate(this.#doc, update)
  }

  encodeState(): CrdtUpdate {
    return Y.encodeStateAsUpdate(this.#doc)
  }

  snapshot(): CrdtSnapshot {
    // Self-contained: applying it to a fresh doc reconstructs this state.
    return Y.encodeStateAsUpdate(this.#doc)
  }

  subscribe(listener: (event: CrdtTextEvent) => void): () => void {
    const handler = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      const origin = isEditOrigin(transaction.origin) ? transaction.origin : undefined
      const text = this.#text.toString()
      listener(
        origin
          ? { text, remote: !transaction.local, origin }
          : { text, remote: !transaction.local },
      )
    }
    this.#text.observe(handler)
    return () => this.#text.unobserve(handler)
  }

  destroy(): void {
    this.#doc.destroy()
  }
}

function openDoc(init?: CrdtUpdate): YjsNote {
  // gc:false retains tombstones so snapshots/history stay reconstructable (AD-4).
  const doc = new Y.Doc({ gc: false })
  if (init !== undefined) Y.applyUpdate(doc, init)
  return new YjsNote(doc)
}

export const yjsEngine: CrdtEngine = {
  open: (init) => openDoc(init),
  fromSnapshot: (snapshot) => openDoc(snapshot),
}
