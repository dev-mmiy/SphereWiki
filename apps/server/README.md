# @spherewiki/server — the sync super-peer

The always-on authoritative CRDT replica: a **Hocuspocus** WebSocket server that holds each
workspace's live Y.Docs, relays edits between peers (desktop + web), and persists rooms so they
survive restarts. It is the server side of the SphereWiki sync transport (M3).

Room joins can be gated by a `RoomAuthorizer` (workspace-scoped token → transport-level project
isolation); it defaults **open** for zero-config local/dev sync. Real token issuance (WorkOS) is P3.

## Run locally

```bash
pnpm dev:server          # build @spherewiki/shared + the server, then start it
# → [spherewiki] sync super-peer listening on ws://0.0.0.0:8787
```

Point a client at it by setting `VITE_SYNC_URL` when you run the app:

```bash
VITE_SYNC_URL=ws://localhost:8787 pnpm dev        # desktop
VITE_SYNC_URL=ws://localhost:8787 pnpm dev:web    # web
```

`PORT` and `SPHEREWIKI_DATA_DIR` (the per-room file-persistence dir) are configurable via env.

## Deploy (P2 — Fly.io)

The `Dockerfile` (built from the **repo root** so the pnpm workspace resolves) and `fly.toml` are
committed. TLS + WebSocket upgrades are terminated by Fly, so clients connect over `wss://`.

```bash
# One-time: install flyctl + sign in (your account — this is the step Claude can't do for you)
#   brew install flyctl && fly auth login

# From the repo root:
fly launch --no-deploy --copy-config --dockerfile apps/server/Dockerfile   # edit app/region in fly.toml
fly volumes create spherewiki_data --size 1 --region <your-region>          # durable rooms
fly deploy --dockerfile apps/server/Dockerfile

# Fly builds the image remotely (no local Docker daemon needed). The app is then reachable at
#   wss://<app-name>.fly.dev
# Set that as VITE_SYNC_URL for the built clients and rebuild them.
```

Build/run the image locally instead (needs a running Docker daemon):

```bash
docker build -f apps/server/Dockerfile -t spherewiki-sync .
docker run --rm -p 8787:8787 spherewiki-sync
```

## Access control (P3)

Set **`SPHEREWIKI_SYNC_SECRET`** to gate joins: every client must then present a valid
**workspace-scoped token** whose workspace matches the room, or the connection is rejected
(transport-level project isolation — a token for workspace A can't join B's rooms). Unset → **open
rooms** (the zero-config local/dev default). A public deployment MUST set the secret.

```bash
# On the host (e.g. Fly), set the secret:
fly secrets set SPHEREWIKI_SYNC_SECRET="$(openssl rand -hex 32)" --app spherewiki

# Mint a token for a workspace (needs the same secret) and hand it to a client as VITE_SYNC_TOKEN:
SPHEREWIKI_SYNC_SECRET=... node scripts/issue-sync-token.mjs ws-dev   # prints a token
VITE_SYNC_URL=wss://spherewiki.fly.dev VITE_SYNC_TOKEN=<token> pnpm dev
```

Who receives a token for which workspace — the per-user, per-membership issuance gate — is **P3b**
(WorkOS-authenticated). Until then, minting is manual (the secret-holder issues tokens). The token
mechanism itself (`issueWorkspaceToken` / `verifyWorkspaceToken` in `@spherewiki/shared`, and
`createWorkspaceTokenAuthorizer` here) is complete + tested.

### Limits

- **Persistence** is a single file-backed volume → keep the app **single-machine** for now. Horizontal
  scale needs server-side shared storage (Postgres + `pgvector` / S3), which lands with the control
  plane (P4).
