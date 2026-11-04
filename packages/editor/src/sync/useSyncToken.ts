import { type FetchImpl, fetchSyncToken, type SyncToken } from "@spherewiki/shared"
import { useEffect, useState } from "react"

/** The state of a live sync-token fetch (M3b P3b). */
export type SyncTokenStatus = "idle" | "loading" | "ready" | "error"

export interface UseSyncTokenResult {
  readonly token: SyncToken | null
  readonly status: SyncTokenStatus
  readonly error: string | null
}

/**
 * The client-side sync-token fetch seam (M3b P3b). Given a sync URL, fetches a workspace-scoped
 * `SyncToken` from the server's `POST /sync-token` control-plane endpoint — so each client mints
 * its own token instead of sharing a static `VITE_SYNC_TOKEN` shipped at build time. The
 * super-peer's `RoomAuthorizer` then re-verifies it on every join.
 *
 * The bearer (when signed in) is forwarded verbatim to the endpoint; the SERVER decides which
 * workspace's token to mint by verifying that bearer into a `Session` — the client never picks.
 * The token is null while no URL is set, while loading, or when the fetch fails (the local /
 * open-sync path is unaffected: an open RoomAuthorizer lets a join through without one, matching
 * `dev:local`). `fetchImpl` is injectable (omit it for the platform `fetch` via `fetchSyncToken`)
 * so the hook's wire behavior is testable without a real socket.
 */
export const useSyncToken = (
  syncUrl?: string,
  authHeader?: string,
  fetchImpl?: FetchImpl,
): UseSyncTokenResult => {
  const [token, setToken] = useState<SyncToken | null>(null)
  const [status, setStatus] = useState<SyncTokenStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!syncUrl) {
      setToken(null)
      setStatus("idle")
      setError(null)
      return
    }
    let cancelled = false
    setStatus("loading")
    setError(null)
    void fetchSyncToken({ url: syncUrl, authHeader }, fetchImpl).then(
      (tok) => {
        if (cancelled) return
        setToken(tok)
        setStatus("ready")
      },
      (err: unknown) => {
        if (cancelled) return
        setToken(null)
        setStatus("error")
        setError(err instanceof Error ? err.message : "sync-token fetch failed")
      },
    )
    return () => {
      cancelled = true
    }
  }, [syncUrl, authHeader, fetchImpl])

  return { token, status, error }
}
