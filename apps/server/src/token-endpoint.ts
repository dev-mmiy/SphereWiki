// The control-plane sync-token endpoint (M3b P3b). `POST /sync-token` authenticates the caller
// (an Authorization bearer verified into a `Session` by the injected `SessionVerifier` — WorkOS
// AuthKit in production, a fake in tests) and answers with a workspace-scoped sync token, but ONLY
// if the session is a member of the requested workspace (`issueSyncTokenForSession`). Clients fetch
// a token here instead of shipping a static `VITE_SYNC_TOKEN`; the super-peer's RoomAuthorizer then
// re-verifies it on every room join. Issuance is the access gate: the secret never leaves the
// server, so who gets a token — and for which workspace — is decided here, server-authoritatively.

import type { IncomingMessage, ServerResponse } from "node:http"
import { asWorkspaceId, issueSyncTokenForSession, type Session } from "@spherewiki/shared"

/**
 * Verifies a caller's bearer credential into a `Session`, or null when it is missing/invalid.
 * The WorkOS-backed implementation lives in `workos-session.ts`; tests inject fakes.
 */
export type SessionVerifier = (bearer: string) => Promise<Session | null>

export interface TokenIssuerOptions {
  /** The sync-token signing secret — the same one the RoomAuthorizer verifies with. */
  secret: string
  /** Authenticates the caller (control plane, server-authoritative). */
  verifySession: SessionVerifier
  /** Issued-token lifetime; defaults to the shared token default (1h). */
  ttlSeconds?: number
  /** CORS origin allowed to call the endpoint from a browser; defaults to "*" (bearer auth, no cookies). */
  allowOrigin?: string
}

export const TOKEN_PATH = "/sync-token"

const BODY_LIMIT_BYTES = 16 * 1024

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        resolve(null) // oversized → treated as malformed
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", () => resolve(null))
  })
}

function bearerOf(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header) : null
  return match?.[1] ?? null
}

/**
 * Handle `POST /sync-token` (+ its CORS preflight). Returns true when the request was for the
 * endpoint path and a response has been written — the caller then stops default request handling;
 * any other path returns false untouched (the health check stays as-is).
 */
export async function handleTokenRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: TokenIssuerOptions,
): Promise<boolean> {
  const path = (req.url ?? "").split("?")[0]
  if (path !== TOKEN_PATH) return false

  const cors: Record<string, string> = {
    "access-control-allow-origin": options.allowOrigin ?? "*",
  }
  const json = (status: number, body: Record<string, unknown>): true => {
    res.writeHead(status, { ...cors, "content-type": "application/json" })
    res.end(JSON.stringify(body))
    return true
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...cors,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
    })
    res.end()
    return true
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "POST, OPTIONS")
    return json(405, { error: "method not allowed" })
  }

  const bearer = bearerOf(req)
  if (bearer === null) return json(401, { error: "missing bearer credential" })

  let session: Session | null
  try {
    session = await options.verifySession(bearer)
  } catch {
    // The identity provider erred (not the caller) — never mint a token on an unverified identity,
    // and never let the failure crash the sync server.
    return json(502, { error: "session verification failed" })
  }
  if (session === null) return json(401, { error: "invalid credential" })

  const raw = await readBody(req)
  let workspaceId: string | undefined
  try {
    const parsed: unknown = raw === null ? undefined : JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null) {
      const candidate = (parsed as Record<string, unknown>).workspaceId
      if (typeof candidate === "string" && candidate !== "") workspaceId = candidate
    }
  } catch {
    // fall through → 400
  }
  if (workspaceId === undefined) {
    return json(400, { error: "body must be JSON with a non-empty string workspaceId" })
  }

  const token = await issueSyncTokenForSession(
    session,
    asWorkspaceId(workspaceId),
    options.secret,
    {
      ...(options.ttlSeconds !== undefined ? { ttlSeconds: options.ttlSeconds } : {}),
    },
  )
  if (token === null) return json(403, { error: "not a member of this workspace" })

  return json(200, {
    token,
    workspaceId,
    expiresInSeconds: options.ttlSeconds ?? 3600,
  })
}
