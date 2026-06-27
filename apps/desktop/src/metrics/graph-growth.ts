import type { WorkspaceMetrics } from "@spherewiki/shared"

/**
 * Graph-growth instrumentation behind the M5 "the note graph measurably grows" dogfooding signal.
 * We persist a **baseline** snapshot the first time a workspace is opened (after hydration), then
 * the metrics panel shows the signed delta of notes / links / tags since that baseline — a local,
 * DB-free proxy for "is the wiki growing as we use it?". The precise per-edit attribution ledger
 * still lands with the version-store DB; this is the local interim, like the AI counters.
 */
export interface GraphSnapshot {
  readonly notes: number
  readonly links: number
  readonly tags: number
}

/** Signed change in each tracked dimension since the baseline (can be negative on deletions). */
export type GraphGrowth = GraphSnapshot

export interface GraphBaselineRecorder {
  /** Capture the baseline from `current` the first time it's called; a no-op afterward. */
  ensure(current: GraphSnapshot): void
  /** Growth (current − baseline) per dimension; `null` until a baseline exists. */
  growth(current: GraphSnapshot): GraphGrowth | null
}

export interface GraphBaselineOptions {
  /** Backing store; omit for an in-memory (non-persisted) recorder. */
  readonly storage?: Pick<Storage, "getItem" | "setItem">
  /** Storage key (per workspace); required for persistence. */
  readonly key?: string
}

/** Pull the tracked dimensions out of a full WorkspaceMetrics. */
export function graphSnapshot(m: WorkspaceMetrics): GraphSnapshot {
  return { notes: m.notes, links: m.links, tags: m.tags }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

function parseSnapshot(value: unknown): GraphSnapshot | null {
  if (typeof value !== "object" || value === null) return null
  const o = value as Record<string, unknown>
  const notes = num(o.notes)
  const links = num(o.links)
  const tags = num(o.tags)
  if (notes === null || links === null || tags === null) return null
  return { notes, links, tags }
}

export function createGraphBaselineRecorder(
  options: GraphBaselineOptions = {},
): GraphBaselineRecorder {
  const { storage, key } = options

  const load = (): GraphSnapshot | null => {
    if (storage === undefined || key === undefined) return null
    try {
      const raw = storage.getItem(key)
      return raw === null ? null : parseSnapshot(JSON.parse(raw))
    } catch {
      return null
    }
  }

  let baseline = load()

  const persist = (): void => {
    if (storage === undefined || key === undefined || baseline === null) return
    try {
      storage.setItem(key, JSON.stringify(baseline))
    } catch {
      // Storage full/unavailable — keep the in-memory baseline rather than throw on a metric write.
    }
  }

  return {
    ensure(current) {
      if (baseline !== null) return
      baseline = parseSnapshot(current)
      persist()
    },
    growth(current) {
      if (baseline === null) return null
      return {
        notes: current.notes - baseline.notes,
        links: current.links - baseline.links,
        tags: current.tags - baseline.tags,
      }
    },
  }
}
