import {
  type AiNoteLedger,
  aiNoteLedger,
  type LedgerVersion,
  type Version,
  type VersionStore,
} from "@spherewiki/shared"

/**
 * The editor-side I/O around the pure, DB-free M5 ledger core in `@spherewiki/
 * shared`. `aiNoteLedger` is a pure math over a `LedgerVersion[]`; this wrapper
 * is the thin layer that *materialises* a note's timeline into that shape:
 *
 * - it reads the version history straight from the note's {@link VersionStore}
 *   (`store.list()`), so — like the version history itself — it needs **no DuckDB
 *   session store**;
 * - each `Version.snapshot` is an opaque `CrdtSnapshot`, so to diff a version's
 *   introduced links/tags we materialise its full text via `store.open(id).
 *   getText()` and immediately `destroy()` it;
 * - a version's `parentText` is the text of the version it `parentId`-points at —
 *   the note's state just before this one — or `""` for the timeline's first
 *   version (whose introduction counts against the empty note, so a brand-new
 *   AI-authored note attributes every link/tag to the AI).
 *
 * A text is cached by id so a version used both as a timeline node and as its
 * child's parent is opened once, not twice. A `parentId` that no longer resolves
 * (a corrupt/foreign history) degrades to the empty base rather than throwing, so
 * a bad record never takes the panel down.
 */
export function aiLedgerForNote(
  store: VersionStore,
  currentText: string,
  versions: readonly Version[] = store.list(),
): AiNoteLedger {
  if (versions.length === 0) return aiNoteLedger([], currentText)

  // id → materialised text, opened once and reused.
  const texts = new Map<string, string>()
  const materialise = (id: string): string => {
    const cached = texts.get(id)
    if (cached !== undefined) return cached
    let text = ""
    try {
      const opened = store.open(id)
      try {
        text = opened.getText()
      } finally {
        opened.destroy()
      }
    } catch {
      // Unknown id (a corrupt/foreign parent link): treat as the empty base so the
      // whole ledger degrades gracefully instead of throwing on one bad record.
    }
    texts.set(id, text)
    return text
  }

  const ledger: LedgerVersion[] = versions.map((v) => ({
    id: v.id,
    origin: v.origin,
    text: materialise(v.id),
    parentText: v.parentId !== undefined ? materialise(v.parentId) : "",
  }))

  return aiNoteLedger(ledger, currentText)
}
