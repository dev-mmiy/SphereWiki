import { describe, expect, it } from "vitest"
import { issueWorkspaceToken, verifyWorkspaceToken } from "./workspace-token"

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
