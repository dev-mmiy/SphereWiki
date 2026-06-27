import type { Version } from "./types"

/**
 * How many AI-authored versions come *after* `targetId` in a note's history — i.e. the AI edits
 * that reverting to `targetId` would undo. The signal behind "kept-vs-reverted": when a human
 * reverts past the agent's auto-link/auto-tag versions, those suggestions were rejected. Returns
 * 0 when the target isn't found. Pure.
 */
export function countAiVersionsAfter(versions: readonly Version[], targetId: string): number {
  const index = versions.findIndex((v) => v.id === targetId)
  if (index === -1) return 0
  let count = 0
  for (let i = index + 1; i < versions.length; i++) {
    if (versions[i]?.origin.kind === "ai") count++
  }
  return count
}

/**
 * Fraction of applied AI edits that were kept (not reverted), in `[0, 1]`; `null` when none have
 * been applied yet. Clamped at 0 because a pathological revert→re-apply→revert sequence can
 * over-count reverts (the running totals are an approximation, not a per-edit ledger).
 */
export function aiKeptRate(applied: number, reverted: number): number | null {
  if (applied <= 0) return null
  return Math.max(0, applied - reverted) / applied
}
