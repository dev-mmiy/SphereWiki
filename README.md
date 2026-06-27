# SphereWiki

A team knowledge base where people and AI grow the wiki together — local-first, Obsidian-style, with AI that actively maintains the graph.

- **Product & architecture decisions:** [docs/PRODUCT.md](docs/PRODUCT.md)
- **MVP scope & milestones:** [docs/ROADMAP.md](docs/ROADMAP.md)
- **Working in this repo (the Loop):** [CLAUDE.md](CLAUDE.md)

## Develop

```bash
pnpm install
pnpm dev            # desktop app (Vite/React) → http://localhost:5173
pnpm dev:web        # web client shell (reuses @spherewiki/ui)
pnpm dev:server     # sync super-peer + API
pnpm verify         # typecheck + lint + test + build (the Loop gates)
pnpm test <pattern> # focused unit test, e.g. pnpm test wikilink
pnpm test:e2e       # real-browser Playwright E2E (desktop) — needs `playwright install chromium` once
pnpm reindex        # rebuild a workspace's derived stores from Markdown (idempotency check)
```

CI (GitHub Actions) runs `pnpm verify` + `pnpm test:e2e` on every push to `main` and every PR.

## Layout

Monorepo (pnpm workspaces):

- `packages/shared` — platform-free core: Markdown, wikilinks, CRDT adapter, engine-agnostic versioning, types
- `packages/ai` — embeddings, RAG, the on-save agent
- `packages/ui` — shared design system: design tokens, base CSS, theme, generic React primitives (reused by desktop + web)
- `apps/desktop` — Tauri 2 + React + CodeMirror 6 client (local-first)
- `apps/web` — browser client shell (no local filesystem; reaches a workspace via the super-peer)
- `apps/server` — Hocuspocus super-peer + Next.js API (GCP)

Current state: **M2a (editor-first) complete** — the desktop app runs as a Vite/React web build with the CodeMirror↔Yjs editor, a multi-note vault, wikilink/backlinks navigation, and commit/diff/revert history (`pnpm dev`). Native shell + on-disk `.md` vault + DuckDB search (Tauri/Rust) are the deferred **M2b**. The **M3a** sync/persistence/auth foundations plus a **real Hocuspocus WebSocket** super-peer (M3b) have also landed. **Storage + sync are now wired end-to-end, no credentials:** the desktop vault **persists to `localStorage`** so documents survive reload offline; the super-peer **durably persists** each room to disk (`pnpm dev:server`); and the desktop app **syncs notes live** through it when `VITE_SYNC_URL` is set (two clients converge; state survives a server restart — integration-tested over real sockets). A synced room also **caches its CRDT state locally (IndexedDB, via y-indexeddb)** so it stays **readable offline** — on reopen the last-synced content loads with no server, and the super-peer merges live edits back on top via Yjs. The **note list itself converges across peers** too: a per-workspace note-registry CRDT syncs over a workspace-level room, so a note created on one peer appears on the others (note ids are collision-resistant UUIDs; reconcile is add-only so a local note is never lost; seeding stays server-authoritative to avoid double-seed). Deleting a note is a **revertible soft-delete tombstone** that syncs across peers and keeps the Markdown body (restorable from a Trash), so a delete never silently destroys work. **Renaming** a note repoints every `[[wikilink]]` backlink across the vault atomically (link integrity) and converges the new title to peers. Each note's **tags** — the AI's auto-tags, read from frontmatter — are surfaced in a navigable **Tags panel** (click a tag to find co-tagged notes), so the auto-tag half of the product is now visible and usable. People and AI **co-curate** those tags: an editor can add or remove a tag in the panel, applied through the note's CRDT doc so it's versioned and revertible like any edit. The workspace also renders a **basic graph view** — notes as nodes, `[[wikilink]]` relationships as edges (dangling and self-links dropped), in a deterministic SVG layout where clicking a node navigates to that note. A **full-text search** box finds notes by content (title + body + tags, prefix-matched, ranked); the in-memory index is the seam DuckDB FTS slots into later. Outgoing links to notes that don't exist yet show as **"+ create"** (dangling/"red" links): clicking one creates the note and resolves the link — the wiki way to grow the graph as you write. Those unwritten targets also appear in the graph as dashed **"ghost" nodes** (the wiki's frontier); clicking one creates it too. A compact **workspace metrics** readout (notes · links · tags · tagged · unwritten) surfaces the dogfooding "is the wiki growing?" signal, derived from Markdown — alongside the AI's **kept-vs-reverted** rate (how often the agent's auto-links/tags are kept rather than reverted), accumulated across sessions. With no notes (e.g. after deleting them all) the workspace shows a guided **empty state** with a "create your first note" action rather than a blank editor. Cloud persistence (Cloud SQL/GCS) and WorkOS auth remain deferred (credentials). **M4a (the AI differentiator) is complete** — `packages/ai` ships the on-save AI agent (auto-link/auto-tag applied as attributed, revertible, merge-safe CRDT edits, permission/autonomy-gated), a per-workspace-isolated vector index, scoped RAG retrieval + answering, and idempotent reindex, all behind swappable seams; the agent is **wired into the desktop app** (an "Organize with AI" action; AI edits show up as revertible versions in the history panel), plus a RAG **"Ask the workspace"** panel that returns cited answers scoped to the workspace. The real Claude/ONNX/pgvector backends (M4b) need credentials + a model download and are deferred. See [docs/ROADMAP.md](docs/ROADMAP.md).

**Local-first foundation — no sign-in, no credentials.** The desktop app is usable fully offline as a first-class **local single-user mode** (`localAuth`), and local state now survives a reload **end-to-end**: note bodies (localStorage vault), the note list + **Trash** tombstones (IndexedDB registry), each note's **version history**, and **session prefs** (last active note + AI mode) all persist. The design foundation is extracted into **`@spherewiki/ui`** and reused by a minimal **`apps/web`** shell (the web-reuse seam). Quality is guarded by a **real-browser Playwright E2E** suite (`pnpm test:e2e`, real CodeMirror + localStorage/IndexedDB across a real reload) — which already caught a corruption bug the jsdom tests couldn't see — and by **CI** that runs the gates + E2E on every change. Progress and the next tasks live in [docs/Todo.md](docs/Todo.md).
