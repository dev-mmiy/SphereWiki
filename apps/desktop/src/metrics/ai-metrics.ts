/**
 * Accumulating counters behind the "kept-vs-reverted" dogfooding signal: how many of the on-save
 * AI agent's edit batches were applied vs later reverted by a human, plus the cumulative links /
 * tags it added. Totals persist (localStorage) so they accumulate across sessions — the per-edit
 * ledger that would make this exact lands with the version-store DB; until then these running
 * totals are the local interim. A no-storage recorder is an in-memory fake for tests.
 */
export interface AiEditMetrics {
  /** AI edit batches the agent applied (auto-link/auto-tag runs that changed a note). */
  readonly applied: number
  /** AI edit batches a human reverted (rolled back past). */
  readonly reverted: number
  /** Cumulative links the AI added. */
  readonly links: number
  /** Cumulative tags the AI added. */
  readonly tags: number
}

const ZERO: AiEditMetrics = { applied: 0, reverted: 0, links: 0, tags: 0 }

export interface AiMetricsRecorder {
  /** Record one applied AI edit batch and the links/tags it added. */
  recordApply(edit: { links: number; tags: number }): void
  /** Record that a human revert rolled back `aiVersions` AI edits (no-op for 0). */
  recordRevert(aiVersions: number): void
  snapshot(): AiEditMetrics
}

export interface AiMetricsOptions {
  /** Backing store; omit for an in-memory (non-persisted) recorder. */
  readonly storage?: Pick<Storage, "getItem" | "setItem">
  /** Storage key (per workspace); required for persistence. */
  readonly key?: string
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0

export function createAiMetricsRecorder(options: AiMetricsOptions = {}): AiMetricsRecorder {
  const { storage, key } = options

  const load = (): AiEditMetrics => {
    if (storage === undefined || key === undefined) return { ...ZERO }
    try {
      const raw = storage.getItem(key)
      if (raw === null) return { ...ZERO }
      const parsed = JSON.parse(raw) as Partial<AiEditMetrics>
      // Validate every field — a malformed/foreign blob must never poison the counters.
      return {
        applied: count(parsed.applied),
        reverted: count(parsed.reverted),
        links: count(parsed.links),
        tags: count(parsed.tags),
      }
    } catch {
      return { ...ZERO }
    }
  }

  let totals = load()
  const persist = (): void => {
    if (storage === undefined || key === undefined) return
    try {
      storage.setItem(key, JSON.stringify(totals))
    } catch {
      // Storage full/unavailable — keep counting in memory rather than throw on a metric write.
    }
  }

  return {
    recordApply(edit) {
      totals = {
        applied: totals.applied + 1,
        reverted: totals.reverted,
        links: totals.links + count(edit.links),
        tags: totals.tags + count(edit.tags),
      }
      persist()
    },
    recordRevert(aiVersions) {
      if (aiVersions <= 0) return
      totals = { ...totals, reverted: totals.reverted + count(aiVersions) }
      persist()
    },
    snapshot: () => totals,
  }
}
