# SphereWiki — MVP & Roadmap

> Companion to [`PRODUCT.md`](PRODUCT.md) (requirements + decisions AD-1…AD-8) and
> [`../CLAUDE.md`](../CLAUDE.md) (loop & architecture). This file defines the **MVP scope and the
> milestone plan** to reach it. For **live progress and the next actions**, see [`Todo.md`](Todo.md).

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

Each milestone ends green on all Loop gates (`pnpm verify`) and meets its acceptance criteria. Where
a milestone is split (e.g. an `a` slice that's local-testable and a `b` slice that needs credentials
or the Rust toolchain), the split exists so the value can land incrementally without external
dependencies blocking the loop.

**M0 — Foundations & the Loop.** pnpm monorepo; packages `shared` / `desktop` / `server` / `ai` as stubs; wire the stable command aliases (`pnpm verify` / `typecheck` / `lint` / `test` / `build`, `pnpm reindex`); first test green.
*Done when:* `pnpm verify` passes on the stub repo and the loop is runnable end-to-end.

**M1 — `shared` core (offline, pure).** Markdown/frontmatter parsing; wikilink/backlink/graph; the **CRDT adapter (Yjs)** + **engine-agnostic version layer** (snapshot / restore / diff / revert / attribution contract); shared types.
*Done when:* unit-tested, platform-free, with strong coverage on link integrity and version revert.

**M2a — Desktop editor, editor-first.** Vite + React; CodeMirror 6 ↔ per-note Yjs; multi-note in-memory `Vault`; wikilink / backlink / graph navigation; history / diff / revert UI. Runs as a web build (`pnpm dev`) ahead of the native shell.
*Done when:* a single user edits, navigates links, and uses history/revert.

**M2b — Native shell & persistence (needs Rust/Tauri).** Tauri 2 wrap; **on-disk Markdown vault** (file-backed `Vault` behind the existing seam); **DuckDB** local index (FTS / graph / vectors) + idempotent `reindex`. Split out of the editor-first slice because it needs the Rust toolchain — best done in a dedicated session.
*Done when:* the desktop app reads/writes a real `.md` vault offline and search works.

**M3a — Sync, persistence & auth foundations.** The super-peer **sync seam** (two-client convergence, server-readable authoritative replica, no echo); the **persistence seam** (durable per-room replica, restored across restart, per-room isolation); the **auth seam** (sessions/roles + `can`/`roleFor`, non-member = no access). Pure, swappable, unit-tested — no external services.
*Done when:* convergence, durability, and permission checks are proven in tests.

**M3b — Real transport, durable storage & cloud control plane.** A real **Hocuspocus WebSocket** super-peer with durable per-room storage; the desktop wired to it for live per-room sync (server-authoritative, hydration-guarded). The **cloud control plane** lands here: **WorkOS** AuthKit (accounts/org/workspaces/roles), **Cloud SQL + `pgvector` + GCS** persistence, and **Postgres RLS** for DB-level tenant isolation (needs credentials).
*Done when:* desktop/web sync against the *deployed* server with real accounts, and cross-workspace access is provably blocked at the DB.

**M4a — On-save AI agent + RAG, local-testable.** The `@spherewiki/ai` package: a content-addressed **embedding seam** + a deterministic local embedder; a **per-workspace vector index** sealed to one workspace by construction (with a read-only view as the only shared-workspace bridge); a no-LLM **heuristic suggester** (auto-link + auto-tag) with pure, idempotent application; a **scoped RAG retriever** (project + opt-in read-only shared) + a deterministic answerer; the **on-save agent** that applies AI edits as a CRDT peer (`setText({kind:'ai'})` + a committed Version — attributed, revertible, merge-safe, permission- and autonomy-gated); an idempotent **reindex** from Markdown alone; and wiring into the desktop UI ("Organize with AI" + an "Ask the workspace" RAG panel).
*Done when:* on save, AI links/tags appear as attributed, revertible edits, and Q&A returns cited answers scoped to the workspace.

**M4b — Real AI backends (needs credentials/download).** Real **multilingual-e5-small (ONNX)** embedder (model download + forced reindex), **pgvector** (server) / **DuckDB** (desktop) vector backends with RLS beneath the by-construction isolation, the **Claude-backed** suggester + answerer (BYO key via Secret Manager), and the **server-side agent as a Hocuspocus CRDT peer** — all behind the unchanged M4a seams.
*Done when:* saving a note on the deployed stack triggers AI links/tags as attributed, revertible edits, and Q&A returns cited answers scoped to the workspace.

**M5 — Dogfood hardening.** Reliability (no lost edits, revert always works, isolation holds), onboarding, and **success-criteria instrumentation** (kept-vs-reverted, graph growth).
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
