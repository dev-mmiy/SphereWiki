import type { FetchImpl, FetchInit, FetchResponse } from "@spherewiki/shared"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useSyncToken } from "./useSyncToken"

/** A hand-built fetch stub: `shared` is platform-free (no DOM/network lib), so no real
 * `Response` is available here and the hook is driven through the injectable `FetchImpl`. */
const json = (body: unknown, status = 200): FetchResponse => ({
  ok: status < 400,
  status,
  json: async () => body,
})

describe("useSyncToken (the client-side sync-token seam, M3b P3b)", () => {
  it("stays idle with a null token while no sync URL is set", () => {
    const { result } = renderHook(() => useSyncToken())
    expect(result.current).toEqual({ token: null, status: "idle", error: null })
  })

  it("mints a token (idle → loading → ready) by POSTing POST /sync-token with the bearer", async () => {
    const calls: Array<{ url: string; init?: FetchInit }> = []
    const fetchImpl: FetchImpl = (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(json({ token: "minted-jwt" }))
    }
    const { result } = renderHook(() =>
      useSyncToken("https://sync/sync-token", "Bearer jwt", fetchImpl),
    )
    // The effect kicked off a load on mount.
    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.token).toBe("minted-jwt")
    expect(result.current.error).toBeNull()
    expect(calls[0]?.url).toBe("https://sync/sync-token")
    expect(calls[0]?.init?.headers?.Authorization).toBe("Bearer jwt")
  })

  it("clears the token and surfaces the failure when the endpoint errors", async () => {
    const fetchImpl: FetchImpl = async () => json(null, 503)
    const { result } = renderHook(() =>
      useSyncToken("https://sync/sync-token", undefined, fetchImpl),
    )
    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current.token).toBeNull()
    expect(result.current.error).toMatch(/HTTP 503/)
  })
})
