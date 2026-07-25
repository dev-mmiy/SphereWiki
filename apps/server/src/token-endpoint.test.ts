import { asWorkspaceId, type Session, verifyWorkspaceToken } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { createSyncServer } from "./sync-server"
import type { SessionVerifier } from "./token-endpoint"

const SECRET = "endpoint-test-secret"

// A fake control-plane identity: bearer "alice" is an authenticated member of ws1 only.
const alice: Session = {
  account: { id: "user_alice", email: "alice@example.com" },
  orgId: "org_1",
  memberships: [{ workspaceId: asWorkspaceId("ws1"), role: "editor" }],
}
const verifySession: SessionVerifier = async (bearer) => (bearer === "alice" ? alice : null)

async function withServer(
  run: (base: string) => Promise<void>,
  verify: SessionVerifier = verifySession,
): Promise<void> {
  const server = createSyncServer({
    port: 0,
    tokenIssuer: { secret: SECRET, verifySession: verify },
  })
  await server.listen()
  try {
    await run(`http://127.0.0.1:${server.address.port}`)
  } finally {
    await server.destroy()
  }
}

function post(base: string, opts: { bearer?: string; body?: string } = {}): Promise<Response> {
  return fetch(`${base}/sync-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.bearer !== undefined ? { authorization: `Bearer ${opts.bearer}` } : {}),
    },
    body: opts.body ?? JSON.stringify({ workspaceId: "ws1" }),
  })
}

describe("sync-token endpoint (P3b)", () => {
  it("issues a workspace-scoped token to an authenticated member", async () => {
    await withServer(async (base) => {
      const res = await post(base, { bearer: "alice" })
      expect(res.status).toBe(200)
      const json = (await res.json()) as { token: string; expiresInSeconds: number }
      expect(typeof json.expiresInSeconds).toBe("number")
      const claims = await verifyWorkspaceToken(json.token, SECRET)
      expect(claims?.workspaceId).toBe("ws1")
    })
  })

  it("refuses a non-member (403, no token) — issuance-side project isolation", async () => {
    await withServer(async (base) => {
      const res = await post(base, {
        bearer: "alice",
        body: JSON.stringify({ workspaceId: "ws2" }),
      })
      expect(res.status).toBe(403)
      const json = (await res.json()) as Record<string, unknown>
      expect(json.token).toBeUndefined()
    })
  })

  it("rejects a missing or unverifiable credential with 401", async () => {
    await withServer(async (base) => {
      expect((await post(base)).status).toBe(401) // no Authorization at all
      expect((await post(base, { bearer: "mallory" })).status).toBe(401) // unknown bearer
    })
  })

  it("rejects a malformed request body with 400", async () => {
    await withServer(async (base) => {
      expect((await post(base, { bearer: "alice", body: "not json" })).status).toBe(400)
      expect((await post(base, { bearer: "alice", body: "{}" })).status).toBe(400)
      expect(
        (await post(base, { bearer: "alice", body: JSON.stringify({ workspaceId: 7 }) })).status,
      ).toBe(400)
      expect(
        (await post(base, { bearer: "alice", body: JSON.stringify({ workspaceId: "" }) })).status,
      ).toBe(400)
    })
  })

  it("only POST is allowed on the endpoint path", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/sync-token`)
      expect(res.status).toBe(405)
    })
  })

  it("answers a CORS preflight so browser clients can call it", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/sync-token`, { method: "OPTIONS" })
      expect(res.status).toBe(204)
      expect(res.headers.get("access-control-allow-origin")).toBe("*")
      expect(res.headers.get("access-control-allow-headers")).toMatch(/authorization/i)
      expect(res.headers.get("access-control-allow-methods")).toMatch(/POST/)
    })
  })

  it("responds 502 when the session verifier itself fails (never a token, never a crash)", async () => {
    await withServer(
      async (base) => {
        const res = await post(base, { bearer: "alice" })
        expect(res.status).toBe(502)
      },
      async () => {
        throw new Error("identity provider unreachable")
      },
    )
  })

  it("leaves other routes untouched (the health check stays 200)", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/`)
      expect(res.status).toBe(200)
    })
  })
})
