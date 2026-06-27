import type { SyncState } from "./use-vault-workspace"

const LABEL: Record<SyncState, string> = {
  local: "Local",
  syncing: "Syncing…",
  synced: "Synced",
}

const HINT: Record<SyncState, string> = {
  local: "Local-only — no sync configured. Your notes work fully offline.",
  syncing: "Connecting to peers / the super-peer…",
  synced: "Synced with peers / the super-peer.",
}

/**
 * A small status pill for the active note's sync state. Honest about the offline-first model:
 * "Local" is a first-class state (not an error), not a degraded "offline". A coloured dot carries
 * the at-a-glance signal; the text label keeps it accessible.
 */
export function SyncStatus({ status }: { status: SyncState }) {
  return (
    <span className="sync-status" data-status={status} title={HINT[status]}>
      <span className="sync-dot" aria-hidden="true" />
      {LABEL[status]}
    </span>
  )
}
