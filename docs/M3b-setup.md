# M3b — Real sync-token issuance (runtime setup)

> Status: ✅ **code merged** `main` (`PR #5`, `6569342`); ◐ **runtime provisioning**
> (user two-track — needs WorkOS creds + a `SPHEREWIKI_SYNC_SECRET`).
> This doc is the operator runbook: turn the shipped code on. No code changes.

M3b replaced the static build-time `VITE_SYNC_TOKEN` with a per-client,
server-minted token. A client points at the super-peer, and `useSyncToken`
(fired on `NoteWorkspace` mount) calls `POST /sync-token`, which verifies the
caller's WorkOS AuthKit access token into a `Session` and mints a
**workspace-scoped** sync token. The super-peer's `RoomAuthorizer` re-verifies
that token on every room join — so a token for workspace A can't join B's rooms.
The signing secret never leaves the server.

The relevant code, all on `main`:

- `apps/server/src/token-endpoint.ts` — `POST /sync-token` (+ CORS preflight).
- `apps/server/src/workos-session.ts` — `createWorkOSSessionVerifier`: verifies
  the AuthKit access token (RS256, client-id-pinned JWKS + issuer) and builds the
  shared `Session`; resolves memberships from the interim org→workspace map.
- `apps/server/src/index.ts` — reads the env, wires the verifier + authorizer.
- `packages/shared/src/auth/workspace-token.ts` — `SyncToken` + `fetchSyncToken`.
- `packages/editor/src/sync/useSyncToken.ts` — the client hook + the editor
  barrel export.

## The three runtime knobs

| Var | Where | Effect |
|---|---|---|
| `SPHEREWIKI_SYNC_SECRET` | server | REQUIRED to token-gate rooms. Unset → rooms **open**, `/sync-token` answers **503 unconfigured** → the client's `useSyncToken` proceeds token-less (zero-config `dev:local` parity). A set-but-**empty** value **refuses to start**. |
| `WORKOS_CLIENT_ID` | server | Turns on WorkOS verification. Set **without** the secret → the server **refuses to start** (issuance that protects nothing). |
| `SPHEREWIKI_ORG_WORKSPACES` | server | Interim membership map — `{ org: { ws: role } }` JSON. Unset → `{}` (no one authorized → issuance denied). Malformed fails startup loudly. |
| `VITE_SYNC_URL` | client (build-time) | The super-peer base URL. Drives both real-time sync and token minting (same host). Unset → local/offline. |

All server env vars live in [`.env.example`](../.env.example). The server does
**not** auto-load `.env` (no `dotenv` dependency) — set them per environment
(see below).

## Local / single-user dev — zero-config

Nothing to provision. With no secret, the server runs open rooms and
`/sync-token` returns `503`, so `useSyncToken` simply proceeds without a token.
This preserves the existing `dev:local` behavior — no change needed for a
single developer on their own machine.

```bash
pnpm dev:server                      # open rooms, /sync-token → 503
VITE_SYNC_URL=ws://localhost:8787 pnpm dev:web   # client mints token-less
```

## Local / multi-user — token-gated without WorkOS

Set the secret to gate room joins by shared knowledge of the token. Every client
must present a token minted from that exact secret. Until WorkOS is configured
this is the operator path: mint a token from the secret and hand it out.

```bash
# server:
PORT=8787 SPHEREWIKI_SYNC_SECRET="$(openssl rand -hex 32)" pnpm dev:server
# client: same host; the token is the secret-derived workspace token
```

Once `WORKOS_CLIENT_ID` is set (below), the client no longer ships a static token
— it mints its own via `POST /sync-token`.

## Production — WorkOS AuthKit + Fly

Two tracks. The **code** is already on `main`; this is the **operator** track.

### 1. Provision WorkOS (one-time, in the WorkOS dashboard)

1. Create (or open) a **WorkOS application**; copy its **client id**
   (`client_...`).
2. Enable **User Management** and the **AuthKit** widget; it signs the client
   with an **access-token JWT** (RS256) — the bearer `useSyncToken` forwards.
3. Note the **organization id** of each team/org whose members should be
   authorized (this is the key of `SPHEREWIKI_ORG_WORKSPACES`).

> **JWKS / issuer caveat — verify with a live token.** The verifier checks
> against `https://api.workos.com/sso/jwks/<clientId>` with issuer
> `https://api.workos.com/user_management/<clientId>`. The JWKS path is the
> **SSO** endpoint while the issuer is **User Management** — confirm this
> combination actually verifies a live AuthKit token against your `clientId`.
> If a real token fails verification the server answers **`502 session
> verification failed`** (never a token, never a crash); reconcile the JWKS/issuer
> URLs in `apps/server/src/workos-session.ts` to your application. (This is the
> only runtime-only check in M3b — the whole path is unit-tested with an injected
> local JWKS + a hand-signed JWT, so this live-URL match is the one thing only a
> real WorkOS app can confirm.)

### 2. Configure the server (Fly secrets)

```bash
fly secrets set SPHEREWIKI_SYNC_SECRET="$(openssl rand -hex 32)" --app <app>
fly secrets set WORKOS_CLIENT_ID="client_xxx" --app <app>
fly secrets set SPHEREWIKI_ORG_WORKSPACES='{"org_xxx":{"ws-dev":"admin","shared-kb":"editor"}}' --app <app>
```

Then redeploy so the listeners pick up the new env:

```bash
fly deploy --dockerfile apps/server/Dockerfile      # from the repo root
```

A healthy start prints, on the console:

```
[spherewiki] sync super-peer listening on wss://0.0.0.0:8787
  (data: .spherewiki-data, auth: token-gated, token issuance: WorkOS (/sync-token))
```

`auth: OPEN` with `token issuance: off` means the secret was not set (open rooms)
— a public deployment should **never** ship that.

### 3. Point the clients at it

Set `VITE_SYNC_URL` at build/run time to the Fly app's WebSocket URL. The client
mints its workspace token on mount; the client **never** chooses the workspace —
the server verifies the bearer and decides.

```bash
VITE_SYNC_URL=wss://<app>.fly.dev pnpm build           # desktop + web builds
# or, for the dev servers:
VITE_SYNC_URL=wss://<app>.fly.dev pnpm dev:desktop
VITE_SYNC_URL=wss://<app>.fly.dev pnpm dev:web
```

### 4. Sanity-check from a browser / curl

```bash
# No credential → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<app>.fly.dev/sync-token

# Real AuthKit access token as the bearer → 200 with the workspace token
curl -s -X POST https://<app>.fly.dev/sync-token \
  -H 'authorization: Bearer <authkit-access-token>' \
  -H 'content-type: application/json' \
  -d '{"workspaceId":"ws-dev"}'
```

## Health checks / expected responses

| Situation | `/sync-token` | Rooms |
|---|---|---|
| No `SPHEREWIKI_SYNC_SECRET` | **503 unconfigured** | open (token-less client OK) |
| Secret set, no `WORKOS_CLIENT_ID` | **401** (no verifier wired / no membership) | token-gated |
| WorkOS wired, no membership for the org | **403** (issuance-side isolation — a non-member never gets a token) | token-gated |
| WorkOS wired, `org_id` absent / unrecognized | no memberships → **403/401** | token-gated |
| Valid bearer, member | **200** with workspace token | accepted |
| Verifier errors (JWKS/issuer/ISS mismatch) | **502 session verification failed** | server still up, no token |
| Malformed body / missing `workspaceId` | **400** | — |
| Missing bearer | **401** | — |
| Method not POST | **405** | — |

## What is NOT here yet

- **P4 control plane** — the real membership store (a `SPHEREWIKI_ORG_WORKSPACES`
  JSON map stands in until then) and server-side shared storage
  (Postgres + `pgvector` / S3) that lets persistence scale horizontally.
- **M4b** real AI backends (ONNX / pgvector / Claude).
- **M5** — only remaining work is a real team dogfood of this flow.
