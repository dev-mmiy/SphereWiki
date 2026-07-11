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

### Status / limits

- **Open rooms** (no auth) until P3 wires WorkOS-issued, workspace-scoped tokens into the
  `authorize` seam. Do not put private workspaces on a public deployment before then.
- **Persistence** is a single file-backed volume → keep the app **single-machine** for now. Horizontal
  scale needs server-side shared storage (Postgres + `pgvector` / S3), which lands with the control
  plane (P4).
