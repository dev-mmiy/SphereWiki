# SphereWiki — MVP & Roadmap

> Companion to [`PRODUCT.md`](PRODUCT.md) (requirements + decisions AD-1…AD-8) and [`../CLAUDE.md`](../CLAUDE.md) (loop & architecture). This file defines the MVP scope and the milestone path to it.

## MVP definition

**Goal:** internal / small-team **dogfooding** — validate the core value through daily real use, with a deliberately lower external-polish bar.

**Central hypothesis:** *An AI that automatically grows a shared team knowledge base — auto-linking, auto-tagging, and lightly reorganizing notes on save, with every change versioned and revertible — is valuable enough that a small team keeps using it.*

**Success criteria** (exit the MVP phase when):
- A small team uses SphereWiki as its real knowledge base for ≥ 3–4 weeks.
- On-save AI suggestions (links/tags) are kept far more often than reverted (target ≥ ~70% kept).
- The note graph measurably grows (links/notes per week), with AI contribution visible.
- Users trust AI edits *because* every change is attributed and one-click revertible (low "AI broke my note" incidents).
- Async multi-user sharing works with no lost edits (CRDT convergence holds in practice).

**Quality bar:** *data* reliability (no lost edits, isolation holds, revert always works) is non-negotiable; UI polish, feature breadth, and scale are not.

## In scope (MVP)

| Area | MVP includes |
|---|---|
| Platform | Desktop only (Tauri 2; build all-OS, test on dev OS) |
| Notes | Markdown + frontmatter, `[[wikilinks]]`, backlinks, tags, basic graph view |
| Editor | CodeMirror 6 source editor bound to a per-note Yjs `Y.Text` |
| Collaboration | **Async multi-user** — several people share a workspace; edits merge (Yjs). No real-time cursors/presence yet |
| Sync | Hocuspocus super-peer (server-readable); Cloud SQL + GCS persistence |
| Accounts | WorkOS: accounts (required), organization, workspaces, roles; isolation enforced (RLS + scope) |
| Versioning | Engine-agnostic history layer: timeline, diff, revert, human/AI attribution |
| **AI (core)** | On-save agent (server-side CRDT peer, BYO Claude key): **auto-link + auto-tag**; AI edits versioned, attributed, revertible |
| RAG | Embeddings (e5-small ONNX, desktop + server), pgvector/DuckDB index, basic Q&A over a workspace |

## Out of scope (deferred — see Post-MVP)

Real-time co-editing (cursors/presence) · Web client · Content ingestion (PDF/Office/image OCR) · MCP server · Shared-workspace RAG-inclusion governance UI (MVP starts with project workspaces + at most one shared) · Billing/Stripe · E2E + per-org trusted worker · Mobile · SSO/SCIM · advanced reorganization.

> Architectural invariants still hold for deferred items (isolation, engine-agnostic versioning, control/data-plane split), so deferring is additive — not a future rewrite.

## Milestones to MVP

Each milestone ends green on all Loop gates (`pnpm verify`) and meets its acceptance criteria.

**M0 — Foundations & the Loop.** pnpm monorepo; packages `shared` / `desktop` / `server` / `ai` as stubs; wire the stable command aliases (`pnpm verify` / `typecheck` / `lint` / `test` / `build`, `pnpm reindex`); first test green.
*Done when:* `pnpm verify` passes on the stub repo and the loop is runnable end-to-end.

**M1 — `shared` core (offline, pure).** Markdown/frontmatter parsing; wikilink/backlink/graph; the **CRDT adapter (Yjs)** + **engine-agnostic version layer** (snapshot / restore / diff / revert / attribution contract); shared types.
*Done when:* unit-tested, platform-free, with strong coverage on link integrity and version revert.

**M2a — Desktop editor, editor-first (done).** Vite + React; CodeMirror 6 ↔ per-note Yjs; multi-note in-memory `Vault`; wikilink/backlink/graph navigation; **history/diff/revert UI**. Runtime-verified via jsdom render + hook tests; runs today as a web build (`pnpm dev`).
*Done:* ✅ a single user edits, navigates links, and uses history/revert; `pnpm verify` green.

**M2b — Native shell & persistence (deferred — needs Rust/Tauri).** Tauri 2 wrap; **on-disk Markdown vault** (file-backed `Vault` behind the existing seam); **DuckDB** local index (FTS/graph/vectors) + idempotent `reindex`. Split out of the editor-first slice because it needs the Rust toolchain (heavy on a slow link) — best done in a dedicated session.
*Done when:* the desktop app reads/writes a real `.md` vault offline and search works.

**M3a — Sync, persistence & auth foundations (done, local-testable).** The super-peer **sync seam** (in-memory hub: two-client convergence, server-readable authoritative replica, no echo); the **persistence seam** (durable per-room replica, restored across restart, per-room isolation); the **auth seam** (sessions/roles + `can`/`roleFor`, non-member = no access). All pure, swappable, unit-tested — no external services.
*Done:* ✅ convergence, durability, and permission checks proven in tests; `pnpm verify` green.

**M3b — Real WebSocket transport + durable storage + app sync (done, local) & cloud control plane (deferred — credentials).** ✅ **Hocuspocus WebSocket** super-peer (`apps/server`) — two real clients converge over actual sockets (integration-tested). ✅ **Durable file persistence** (`createFilePersistence`) — one hashed, fixed-length file per room under `SPHEREWIKI_DATA_DIR`, written atomically (temp + rename); room state survives a server restart; the server is runnable via `pnpm dev:server`. ✅ **Desktop wired to the super-peer** — set `VITE_SYNC_URL` and the active note syncs live per room (`workspaceId/noteId`). When syncing the server is authoritative for the room and the client hydrates from it; the writeback is **hydration-guarded** so an un-hydrated (offline / fast-switch) doc can never overwrite the Markdown vault with empty content. Roundtrip integration test proves convergence (incl. concurrent edits) + restore-after-restart over real sockets; the desktop seed-vs-sync + no-clobber logic is unit-tested via an injected transport. **Deferred (need credentials):** **WorkOS** AuthKit (auth seam); **Cloud SQL + GCS** (persistence seam) + Postgres RLS for DB-level isolation.
*Remaining done-when:* desktop/web sync against the *deployed* server with real accounts, and cross-workspace access is provably blocked at the DB.

> **Storage & sync follow-ups (local, no credentials), surfaced by the S1/S2 review:**
> - **Offline-first for *synced* rooms (S3):** today a synced room is online-first — its editor is empty until the server hydrates (the vault is never clobbered, but the content isn't shown offline). Local CRDT persistence (e.g. y-indexeddb) makes synced rooms readable offline *and* lets initial content be seeded **once** (so two clients can't double-seed into garbled text).
> - Sync the *whole vault* (note list + content), not just the active note; multiplex one socket per workspace (the workspace is the replication boundary) instead of one per note.
> - **Persistence compaction:** `gc:false` docs (kept for history snapshots, AD-4) grow unbounded when stored via `encodeStateAsUpdate`; add snapshot/compaction.
> - **Room-level authorization** (`onAuthenticate`): today any client can join any room — isolation is client-side naming only. Real token-checked room access lands with WorkOS in M3b.

**Known M4a limitations (folded into M4b)** — surfaced by the M4a adversarial review; each is bounded and additive, behind the existing seams:
- *Runtime read-only shared indexes:* `ReadonlyVectorIndex` is read-only at the type level only; the real backends (and a frozen projection) make it enforced at runtime.
- *Shared-bridge type enforcement:* the RAG retriever trusts the caller that a passed `shared` index is a `shared`-type workspace; M4b carries workspace `type` and adds Postgres RLS so "never another project" is checked, not conventional.
- *Citation id namespacing:* `readBody` resolves by bare `NoteId`; M4b namespaces ids per workspace so cross-workspace id collision can't source citation text out of scope.
- *Title-metadata staleness:* the embedding/staleness key is body-only (deliberately, so tag edits don't churn the vector); a note rename leaves a stale stored title until re-embed. M4b refreshes title metadata independently.
- *CJK / space-less auto-link:* the heuristic's letter-class word boundaries rarely fire for scripts without inter-word spaces; the M4b Claude suggester (or a segmenter) handles these.
- *Frontmatter canonicalization:* an AI tag edit re-serializes frontmatter to canonical YAML style; M4b can splice the tags region to preserve human formatting if needed.

**M4a — On-save AI agent + RAG, local-testable (done).** The `@spherewiki/ai` package: a content-addressed **embedding seam** + deterministic in-memory embedder; a **per-workspace vector index** sealed to one workspace by construction (cross-workspace access is unrepresentable) with a read-only view as the only shared-workspace bridge; a no-LLM **heuristic suggester** (auto-link + auto-tag) with pure, idempotent application; a **scoped RAG retriever** (project + opt-in read-only shared) and a deterministic extractive answerer; the **on-save agent** that applies AI edits as a CRDT peer via `setText({kind:'ai'})` + a committed Version — attributed, revertible, merge-safe, permission- and autonomy-gated; and an idempotent **reindex** that rebuilds the index from Markdown alone. All seven domain invariants are exercised in tests (incl. type-level isolation guards). No credentials/downloads.
*Done:* ✅ on save, AI links/tags appear as attributed, revertible edits; retrieval is workspace-scoped and cited; `pnpm verify` green. The agent is **wired into the desktop UI** — an "Organize with AI" action runs it on the active note (gated by role, in-flight-guarded, edits land in the history panel as revertible AI versions) using the local heuristic suggester + embedder, and a RAG **"Ask the workspace"** panel returns cited answers (idempotent reindex → scoped retrieval → extractive answer). Split out of M4 because the real backends need a model download + a Claude key.

**M4b — Real AI backends + wiring (deferred — credentials/download).** Real **multilingual-e5-small (ONNX)** embedder (model download + forced reindex), **pgvector** (server) / **DuckDB** (desktop) vector backends with Postgres RLS beneath the by-construction isolation, the **Claude-backed** suggester + answerer (BYO key via Secret Manager), and the **server-side agent as a Hocuspocus CRDT peer** — all behind the M4a seams, unchanged (the desktop "Organize with AI" action is already wired and will simply pick up the real providers; the agent already guards against a mid-run note switch so the real async backends are safe).
*Done when:* saving a note on the deployed stack triggers AI links/tags as attributed, revertible edits, and Q&A returns cited answers scoped to the workspace.

**M5 — Dogfood hardening.** Reliability (no lost edits, revert always works), onboarding, and **success-criteria instrumentation** (kept-vs-reverted, graph growth).
*Done when:* the team runs it daily and the success criteria above are measurable. **← MVP complete.**

## Post-MVP (indicative order)

1. **Real-time co-editing** — presence/cursors on the existing Yjs base.
2. **Web client** — via the super-peer gateway.
3. **Content ingestion** — PDF/Office, then image OCR/captioning.
4. **Multi-project depth** — shared-workspace governance UI, more workspace attributes.
5. **MCP server** — expose the vault to external agents.
6. **Billing** — Stripe subscription (customer = org).
7. **Privacy endgame** — E2E + per-org trusted worker (AD-1).
8. **Later** — mobile, SSO/SCIM, AlloyDB if scale demands.
