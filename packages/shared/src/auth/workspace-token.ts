// Workspace-scoped sync tokens (M3b P3). A bearer token that authorizes joining ONE workspace's
// sync rooms, HMAC-signed with the server's secret so a client can never forge one — minting a token
// requires the secret, so issuance is the access gate (a WorkOS-authenticated membership check
// decides who gets a token for which workspace; that gate is P3b). The super-peer's RoomAuthorizer
// verifies the token and that its workspace matches the room being joined.
//
// Platform-free: uses Web Crypto (`crypto.subtle`) + `btoa`/`atob`, available in Node 20+, browsers,
// and workers — so the same code signs on the server and could verify anywhere.

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
const runtime = globalThis as unknown as {
  crypto: { subtle: Subtle }
  TextEncoder: new () => { encode(input: string): Uint8Array }
  btoa(data: string): string
  atob(data: string): string
}
const enc = new runtime.TextEncoder()

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
