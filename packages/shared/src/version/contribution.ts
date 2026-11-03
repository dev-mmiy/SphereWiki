import type { EditOrigin } from "../crdt/types.js"
import { type LinkTagDelta, linksOf, linkTagDelta, tagsOf } from "./contribution-lex.js"

/**
 * M5 — precise per-edit kept-vs-reverted ledger + AI contribution share,
 * derived **DB-free** from the version timeline.
 *
 * The shared version layer already stamps every {@link Version} with its
 * `origin` (an {@link EditOrigin}): `kind === "ai"` for the on-save AI
 * agent's commit and anything else for a human edit. Combined with each
 * version's full `snapshot` and `parentId`, the timeline alone tells us, for a
 * single note, exactly which links/tags an AI edit introduced — no DuckDB
 * session store required. This module turns that timeline plus the current
 * note text into a precise ledger:
 *
 * - `aiEdits`: distinct AI-origin versions the note has (counted by id, so a
 *   revert→re-apply→revert sequence never double-counts the same value — the
 *   over-count that the running-total interim `AiMetricsRecorder` can't avoid).
 * - For each AI-origin version we diff its introduced links/tags against its
 *   parent snapshot and union them into the note's *ever-introduced* set
 *   (deduped by value, so identical re-introductions count once).
 * - A value is **kept** when it is still present in the current note text and
 *   **reverted** when it has since been removed, so the figure self-corrects:
 *   re-applying a reverted edit brings its values back as *kept* (a precise
 *   signal, not a running total that drifts with revert→re-apply cycles).
 * - `contribution` is the share of the note's *current* links/tags that trace
 *   to an AI edit (`kept ÷ current`), in 0..1, and 0 when the note carries none
 *   — the "AI- vs human-authored" contribution share.
 *
 * {@link aiGraphLedger} folds several notes' ledgers into a graph-wide one, and
 * because each ledger carries the raw `ever`/`kept`/`current` counts the fold is
 * a true *weighted* share (sum of kept ÷ sum of current), never an average of
 * per-note ratios (which would mis-weight tiny notes against big ones).
 *
 * The math is pure and unit-tested here; the thin per-note I/O (materialising
 * each version's snapshot to text) lives in the editor's `ai-ledger.ts`
 * wrapper, which gathers a `LedgerVersion[]` and calls `aiNoteLedger`.
 */

/** A version pre-projected to the shape the pure ledger consumes. */
export interface LedgerVersion {
  readonly id: string
  readonly origin: EditOrigin | undefined
  /** The full text this version pinned. */
  readonly text: string
  /** The text of this version's parent (the note just before it), when known. */
  readonly parentText: string | undefined
}

/** Per-dimension ledger counts for one kind of contribution (links or tags). */
export interface LedgerCounts {
  /** Distinct values an AI edit introduced at some point in the note's history. */
  readonly ever: number
  /** Of those, still present in the note's current text (the kept contribution). */
  readonly kept: number
  /** Of those, since removed from the current text (the reverted contribution). */
  readonly reverted: number
  /** The note's current total of this kind — the contribution denominator. */
  readonly current: number
}

/** The precise, content-grounded per-note ledger. */
export interface AiNoteLedger {
  /** Distinct AI-origin versions — the count of AI edits the note has. */
  readonly aiEdits: number
  readonly links: LedgerCounts
  readonly tags: LedgerCounts
}

/** The raw link/tag values a single note carries, plus a ledger over them. */
export interface NoteContributionInput {
  readonly ledger: AiNoteLedger
  /** The note's current total links — mirrors `ledger.links.current`. */
  readonly linksCurrent: number
  /** The note's current total tags — mirrors `ledger.tags.current`. */
  readonly tagsCurrent: number
}

export const share = (kept: number, currentTotal: number): number =>
  currentTotal === 0 ? 0 : kept / currentTotal

/**
 * Fold a note's version timeline + current text into a precise
 * kept-vs-reverted ledger of the AI's link/tag contributions. Order matters:
 * pass `versions` in the store's insertion order (oldest → newest) so each
 * version's `parentText` is its immediate predecessor.
 */
export function aiNoteLedger(
  versions: readonly LedgerVersion[],
  currentText: string,
): AiNoteLedger {
  // Gather the AI-introduced link/tag values across every AI-origin version,
  // deduped by value so identical re-introductions count once.
  const everLinks = new Set<string>()
  const everTags = new Set<string>()
  let aiEdits = 0
  for (const v of versions) {
    if (v.origin?.kind !== "ai") continue
    aiEdits++
    const delta: LinkTagDelta = linkTagDelta(v.parentText ?? "", v.text)
    for (const l of delta.links) everLinks.add(l)
    for (const t of delta.tags) everTags.add(t)
  }

  const currentLinks = linksOf(currentText)
  const currentTags = tagsOf(currentText)

  const ledgerOf = (ever: Set<string>, current: string[]): LedgerCounts => {
    const kept = [...ever].filter((x) => current.includes(x)).length
    return {
      ever: ever.size,
      kept,
      reverted: ever.size - kept,
      current: current.length,
    }
  }

  return {
    aiEdits,
    links: ledgerOf(everLinks, currentLinks),
    tags: ledgerOf(everTags, currentTags),
  }
}

/** A graph-wide fold of per-note ledgers — the "AI contribution share of the graph". */
export interface AiGraphLedger {
  readonly aiEdits: number
  readonly links: LedgerCounts
  readonly tags: LedgerCounts
}

/**
 * Sum several notes' ledgers into a graph-wide one. Each dimension's `ever`,
 * `kept`, `reverted`, and `current` are added across notes, so the returned
 * `contribution` share (computed by the consumer via {@link share}) is a true
 * *weighted* `Σkept ÷ Σcurrent` — not an average of per-note ratios.
 */
export function aiGraphLedger(notes: readonly NoteContributionInput[]): AiGraphLedger {
  let aiEdits = 0
  let linksEver = 0
  let linksKept = 0
  let linksCurrent = 0
  let tagsEver = 0
  let tagsKept = 0
  let tagsCurrent = 0
  for (const n of notes) {
    aiEdits += n.ledger.aiEdits
    linksEver += n.ledger.links.ever
    linksKept += n.ledger.links.kept
    linksCurrent += n.linksCurrent
    tagsEver += n.ledger.tags.ever
    tagsKept += n.ledger.tags.kept
    tagsCurrent += n.tagsCurrent
  }
  const counts = (ever: number, kept: number, current: number): LedgerCounts => ({
    ever,
    kept,
    reverted: ever - kept,
    current,
  })
  return {
    aiEdits,
    links: counts(linksEver, linksKept, linksCurrent),
    tags: counts(tagsEver, tagsKept, tagsCurrent),
  }
}
