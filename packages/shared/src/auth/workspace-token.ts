// Workspace-scoped sync tokens (M3b P3). A bearer token that authorizes joining ONE workspace's
// sync rooms, HMAC-signed with the server's secret so a client can never forge one — minting a token
// requires the secret, so issuance is the access gate (a WorkOS-authenticated membership check
// decides who gets a token for which workspace; that gate is P3b). The super-peer's RoomAuthorizer
// verifies the token and that its workspace matches the room being joined.
//
// Platform-free: uses Web Crypto (`crypto.subtle`) + `btoa`/`atob`, available in Node 20+, browsers,
// and workers — so the same code signs on the server and could verify anywhere.

import type { WorkspaceId } from "../types"
import { roleFor } from "./permissions"
import type { Session } from "./types"

// Web-standard runtime globals (Web Crypto + base64 + UTF-8), present in Node 20+, browsers, and
// workers. Read off `globalThis` behind local type shims so `shared` stays platform-free (no DOM /
// node lib), mirroring how `vault/file.ts` reaches `crypto.randomUUID`.
interface Subtle {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    keyUsages: "sign"[],
  ): Promise<unknown>
  sign(algorithm: "HMAC", key: unknown, data: Uint8Array): Promise<ArrayBuffer>
}
// The minimal fetch shape the sync-token endpoint needs — read off `globalThis` so `shared` has no
// DOM/node network lib. Present in Node 20+ and browsers; injected in tests.
export interface FetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
export interface FetchInit {
  method?: string
  headers?: Record<string, string>
}
export type FetchImpl = (url: string, init?: FetchInit) => Promise<FetchResponse>

const runtime = globalThis as unknown as {
  crypto: { subtle: Subtle }
  TextEncoder: new () => { encode(input: string): Uint8Array }
  btoa(data: string): string
  atob(data: string): string
  fetch: FetchImpl
}
const enc = new runtime.TextEncoder()

/**
 * A workspace-scoped sync token — an HMAC-signed, JWT-shaped string minted by the server and
 * presented to the super-peer's `RoomAuthorizer` to join ONE workspace's rooms. Branded so a
 * plain string (or a token for another purpose) can't be smuggled in where a real one is required.
 */
export type SyncToken = string & { readonly __syncToken?: unknown }

/** The claims carried by a verified token. */
export interface WorkspaceTokenClaims {
  /** The workspace whose rooms the bearer may join. */
  readonly workspaceId: string
  /** Expiry, epoch milliseconds. */
  readonly exp: number
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return runtime.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecodeToString(part: string): string {
  const s = part.replace(/-/g, "+").replace(/_/g, "/")
  return runtime.atob(s + "=".repeat((4 - (s.length % 4)) % 4))
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await runtime.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return new Uint8Array(await runtime.crypto.subtle.sign("HMAC", key, enc.encode(data)))
}

/** Constant-time string compare (both already the same encoding) — avoids leaking the signature via
 * comparison timing. Compares full length; length mismatch still runs to the end. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Mint a token scoping the bearer to `workspaceId`'s sync rooms, valid for `ttlSeconds` (default 1h).
 * The `secret` is the server's — hold it to issue, so clients cannot forge tokens. `now` is
 * injectable for deterministic tests.
 */
export async function issueWorkspaceToken(
  workspaceId: string,
  secret: string,
  opts: { ttlSeconds?: number; now?: number } = {},
): Promise<string> {
  const now = opts.now ?? Date.now()
  const claims: WorkspaceTokenClaims = {
    workspaceId,
    exp: now + (opts.ttlSeconds ?? 3600) * 1000,
  }
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)))
  const sig = b64urlEncode(await hmac(payload, secret))
  return `${payload}.${sig}`
}

/**
 * Verify a token against `secret`: returns its claims iff the signature is valid AND it has not
 * expired, else `null`. Never throws (a malformed token is just invalid). `now` is injectable.
 */
export async function verifyWorkspaceToken(
  token: string | null | undefined,
  secret: string,
  opts: { now?: number } = {},
): Promise<WorkspaceTokenClaims | null> {
  if (typeof token !== "string") return null
  const dot = token.indexOf(".")
  if (dot <= 0 || dot === token.length - 1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = b64urlEncode(await hmac(payload, secret))
  if (!timingSafeEqual(sig, expected)) return null
  let claims: WorkspaceTokenClaims
  try {
    const parsed = JSON.parse(b64urlDecodeToString(payload)) as Partial<WorkspaceTokenClaims>
    if (typeof parsed.workspaceId !== "string" || typeof parsed.exp !== "number") return null
    claims = { workspaceId: parsed.workspaceId, exp: parsed.exp }
  } catch {
    return null
  }
  if ((opts.now ?? Date.now()) >= claims.exp) return null // expired
  return claims
}

/**
 * Membership-gated issuance (M3b P3b). Mint a sync token for `workspaceId` FOR a given session — but
 * ONLY if the session is a member of that workspace (`roleFor` non-null); a non-member gets `null`,
 * the issuance-side expression of absolute project isolation (you can never obtain a token for a
 * workspace you don't belong to). This is the gate a control-plane token endpoint applies after
 * authenticating the caller: WorkOS AuthKit supplies the real `Session` (with its real memberships),
 * and this function decides whether — and for which workspace — a token is granted. The token then
 * lets the client join that workspace's rooms, where the super-peer's `RoomAuthorizer` re-verifies it.
 */
export async function issueSyncTokenForSession(
  session: Session,
  workspaceId: WorkspaceId,
  secret: string,
  opts: { ttlSeconds?: number; now?: number } = {},
): Promise<string | null> {
  if (roleFor(session, workspaceId) === null) return null // not a member → no token
  return issueWorkspaceToken(workspaceId, secret, opts)
}

// --- Server-side sync-token fetch (M3b P3b) --------------------------------------
//
// The CLIENT side: how a desktop/web client MINTS a `SyncToken` for itself — by POSTing to
// the server's `POST /sync-token` control-plane endpoint (see `apps/server/src/
// token-endpoint.ts`) with its WorkOS bearer. The server verifies the bearer into a `Session`
// and issues a workspace-scoped token ONLY if the session is a member. This replaces the old
// static `VITE_SYNC_TOKEN` (a single shared secret shipped at build time): each client now
// fetches its own token, and the super-peer's RoomAuthorizer re-verifies it on every join.
//
// Platform-free: uses the Web-standard `globalThis.fetch` + `btoa`/`atob`, so the same fetch
// shape works in Node 20+, browsers, and workers. Callers inject a `fetchImpl` in tests.

export interface SyncTokenFetchOptions {
  /**
   * The full URL of the sync-token control-plane endpoint.
   * @example "https://spherewiki.fly.dev/sync-token"
   */
  url: string
  /** Optional `Authorization` header (WorkOS bearer); the server verifies it into a
   *  `Session`. Omit when the endpoint accepts an unauthenticated (local/dev) token. */
  authHeader?: string
}

/**
 * The sync-token fetcher — calls the server's `POST /sync-token` HTTP endpoint and returns
 * the minted `SyncToken`. Mirrors `ConnectNote`/`ConnectRegistry` (a transport seam swappable for a
 * fake in tests). The fetch implementation is injectable (2nd arg); the default reads Web `fetch`
 * off `globalThis` (present in Node 20+ and browsers).
 */
export type SyncTokenSource = (
  options: SyncTokenFetchOptions,
  fetchImpl?: FetchImpl,
) => Promise<SyncToken>

/**
 * The default token source: POSTs to `options.url` with an optional `Authorization` header and
 * parses the JSON `{ token }` response. Throws on non-OK or malformed responses so callers can
 * signal "no token minted" by clearing their auth state.
 */
export const fetchSyncToken: SyncTokenSource = async (options, fetchImpl = runtime.fetch) => {
  const res = await fetchImpl(options.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authHeader ? { Authorization: options.authHeader } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`sync-token fetch failed: HTTP ${res.status}`)
  }
  const body: unknown = await res.json()
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { token?: unknown }).token !== "string"
  ) {
    throw new Error("sync-token fetch: malformed response")
  }
  // The wire value is a server-minted token; trust the transport (the server's
  // RoomAuthorizer re-verifies it on every join, so a forged one never gets in).
  return (body as { token: string }).token as SyncToken
}
