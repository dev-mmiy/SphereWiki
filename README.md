# SphereWiki

A team knowledge base where people and AI grow the wiki together — local-first, Obsidian-style, with AI that actively maintains the graph.

- **Product & architecture decisions:** [docs/PRODUCT.md](docs/PRODUCT.md)
- **MVP scope & milestones:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Working in this repo (the Loop):** [CLAUDE.md](CLAUDE.md)

## Develop

```bash
pnpm install
pnpm verify        # typecheck + lint + test + build (the Loop gates)
pnpm test <pattern> # focused test run, e.g. pnpm test wikilink
```

## Layout

Monorepo (pnpm workspaces):

- `packages/shared` — platform-free core: Markdown, wikilinks, CRDT adapter, engine-agnostic versioning, types
- `packages/ai` — embeddings, RAG, the on-save agent
- `apps/desktop` — Tauri 2 + React + CodeMirror 6 client (local-first)
- `apps/server` — Hocuspocus super-peer + Next.js API (GCP)

Current state: **M2a (editor-first) complete** — the desktop app runs as a Vite/React web build with the CodeMirror↔Yjs editor, a multi-note vault, wikilink/backlinks navigation, and commit/diff/revert history (`pnpm dev`). Native shell + on-disk `.md` vault + DuckDB search (Tauri/Rust) are the deferred **M2b**. The **M3a** sync/persistence/auth foundations plus a **real Hocuspocus WebSocket** super-peer (M3b) have also landed. **Storage + sync are now wired end-to-end, no credentials:** the desktop vault **persists to `localStorage`** so documents survive reload offline; the super-peer **durably persists** each room to disk (`pnpm dev:server`); and the desktop app **syncs notes live** through it when `VITE_SYNC_URL` is set (two clients converge; state survives a server restart — integration-tested over real sockets). A synced room also **caches its CRDT state locally (IndexedDB, via y-indexeddb)** so it stays **readable offline** — on reopen the last-synced content loads with no server, and the super-peer merges live edits back on top via Yjs. Cloud persistence (Cloud SQL/GCS) and WorkOS auth remain deferred (credentials). **M4a (the AI differentiator) is complete** — `packages/ai` ships the on-save AI agent (auto-link/auto-tag applied as attributed, revertible, merge-safe CRDT edits, permission/autonomy-gated), a per-workspace-isolated vector index, scoped RAG retrieval + answering, and idempotent reindex, all behind swappable seams; the agent is **wired into the desktop app** (an "Organize with AI" action; AI edits show up as revertible versions in the history panel), plus a RAG **"Ask the workspace"** panel that returns cited answers scoped to the workspace. The real Claude/ONNX/pgvector backends (M4b) need credentials + a model download and are deferred. See [docs/ROADMAP.md](docs/ROADMAP.md).
