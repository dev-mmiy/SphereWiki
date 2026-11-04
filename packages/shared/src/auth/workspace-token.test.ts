import { describe, expect, it } from "vitest"
import { asWorkspaceId } from "../types"
import type { Session } from "./types"
import {
  fetchSyncToken,
  issueSyncTokenForSession,
  issueWorkspaceToken,
  verifyWorkspaceToken,
} from "./workspace-token"

const SECRET = "test-secret-abc123"

describe("workspace-token", () => {
  it("round-trips: a minted token verifies to its workspace + future expiry", async () => {
    const now = 1_000_000
    const tok = await issueWorkspaceToken("ws-A", SECRET, { ttlSeconds: 60, now })
    const claims = await verifyWorkspaceToken(tok, SECRET, { now })
    expect(claims?.workspaceId).toBe("ws-A")
    expect(claims?.exp).toBe(now + 60_000)
  })

  it("rejects a token signed with a different secret (no forging without the secret)", async () => {
    const tok = await issueWorkspaceToken("ws-A", SECRET)
    expect(await verifyWorkspaceToken(tok, "other-secret")).toBeNull()
  })

  it("rejects a workspace swap — a ws-B payload carrying ws-A's signature", async () => {
    const tokA = await issueWorkspaceToken("ws-A", SECRET)
    const tokB = await issueWorkspaceToken("ws-B", SECRET)
    const payloadB = tokB.slice(0, tokB.indexOf("."))
    const sigA = tokA.slice(tokA.indexOf(".") + 1)
    // ws-B's real payload + ws-A's real signature → the recomputed HMAC over payloadB won't match sigA.
    expect(await verifyWorkspaceToken(`${payloadB}.${sigA}`, SECRET)).toBeNull()
  })

  it("rejects an expired token", async () => {
    const now = 1_000_000
    const tok = await issueWorkspaceToken("ws-A", SECRET, { ttlSeconds: 60, now })
    expect(await verifyWorkspaceToken(tok, SECRET, { now })).not.toBeNull() // valid now
    expect(await verifyWorkspaceToken(tok, SECRET, { now: now + 61_000 })).toBeNull() // past exp
  })

  it("rejects malformed / missing tokens (never throws)", async () => {
    for (const bad of [null, undefined, "", "no-dot", ".", "x.", ".y"]) {
      expect(await verifyWorkspaceToken(bad, SECRET)).toBeNull()
    }
  })
})

describe("issueSyncTokenForSession (membership-gated issuance)", () => {
  const session: Session = {
    account: { id: "u1", email: "u@local" },
    orgId: "org1",
    memberships: [{ workspaceId: asWorkspaceId("ws-A"), role: "editor" }],
  }

  it("issues a token for a workspace the session belongs to", async () => {
    const tok = await issueSyncTokenForSession(session, asWorkspaceId("ws-A"), SECRET)
    expect(tok).not.toBeNull()
    const claims = await verifyWorkspaceToken(tok, SECRET)
    expect(claims?.workspaceId).toBe("ws-A")
  })

  it("returns null for a workspace the session is NOT a member of (no cross-workspace token)", async () => {
    expect(await issueSyncTokenForSession(session, asWorkspaceId("ws-B"), SECRET)).toBeNull()
  })
})

// --- fetchSyncToken (the client-side wire to POST /sync-token, M3b P3a) ----------
//
// A stub stands in for `fetch` so the wire behavior is pinned without a socket. `shared` is
// platform-free (no DOM/network lib), so the fake response is hand-built against the minimal
// `FetchResponse` shape `fetchSyncToken` reads — no global `Response`/`RequestInit` needed. The
// server's token-endpoint.test.ts covers the endpoint side; here we pin that the client POSTs to
// the endpoint, forwards the optional Authorization header, returns the minted `{token}` JSON,
// and surfaces HTTP / malformed failures to the caller.

// The minimal fetch response `fetchSyncToken` consumes (`ok` / `status` / `json`).
type Json = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}
const jsonResponse = (body: unknown, status = 200): Json => ({
  ok: status < 400,
  status,
  json: async () => body,
})

const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string> } }> =
  []
// `fetchSyncToken`'s fetch arg is an injectable `FetchImpl`; satisfy it with the minimal shape.
const stubFetch = (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
  calls.push({ url: String(url), init })
  return Promise.resolve(jsonResponse({ token: "client-minted" }))
}

describe("fetchSyncToken", () => {
  it("POSTs to the endpoint and returns the minted token", async () => {
    calls.length = 0
    const token = await fetchSyncToken({ url: "https://sync/sync-token" }, stubFetch)
    expect(token).toBe("client-minted")
    expect(calls[0]?.url).toBe("https://sync/sync-token")
    expect(calls[0]?.init?.method).toBe("POST")
  })

  it("forwards an optional Authorization (WorkOS bearer) header with a json content-type", async () => {
    calls.length = 0
    await fetchSyncToken(
      { url: "https://sync/sync-token", authHeader: "Bearer workos-jwt" },
      stubFetch,
    )
    const headers = calls[0]?.init?.headers
    expect(headers?.Authorization).toBe("Bearer workos-jwt")
    expect(headers?.["Content-Type"]).toBe("application/json")
  })

  it("throws on a non-OK response so the caller can clear its token", async () => {
    const notConfigured = (_url: string) => Promise.resolve(jsonResponse(null, 503))
    await expect(fetchSyncToken({ url: "https://sync/sync-token" }, notConfigured)).rejects.toThrow(
      /HTTP 503/,
    )
  })

  it("throws on a malformed (token-less) response", async () => {
    const malformed = (_url: string) => Promise.resolve(jsonResponse({ notAToken: true }))
    await expect(fetchSyncToken({ url: "https://sync/sync-token" }, malformed)).rejects.toThrow(
      /malformed response/,
    )
  })
})
