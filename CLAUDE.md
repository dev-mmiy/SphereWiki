# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: active development.** This file defines the architecture and the **Loop Engineering** discipline the project is built around. The command names below are a stable contract — keep the names stable even if the underlying tools change; the loop depends on them, not on raw tool invocations. Full product requirements live in [`docs/PRODUCT.md`](docs/PRODUCT.md); the MVP scope & milestone **plan** in [`docs/ROADMAP.md`](docs/ROADMAP.md); **live progress and the next tasks** in [`docs/Todo.md`](docs/Todo.md).

## Project: SphereWiki

SphereWiki is a **team knowledge base where people and AI grow the wiki together** — local-first, Obsidian-style, with AI that actively maintains the graph.

- **Team-first, multi-project.** An organization holds many *workspaces*, each isolated and carrying a `type` attribute (`project` or `shared`, extensible). Projects are isolated; one or more *shared* workspaces hold org-wide common knowledge that projects can pull in read-only.
- **People + AI co-edit.** AI is a first-class, *versioned* collaborator: on every note save it auto-links, auto-tags, and reorganizes. Every change — human or AI — is tracked and revertible.
- **Local-first + P2P sync.** Desktop works fully standalone and offline. Workspace members sync peer-to-peer via CRDT; the subscription server acts as an always-on **super-peer** (signaling, web gateway, persistence, backup, billing).
- **BYO-key AI.** Each org supplies its own LLM API key (Claude for generation/agents); embeddings run on-device/local. The subscription covers the product (agents, sync, collaboration); LLM token cost passes through to the org.
- **Account-gated, two planes.** Using the app requires an account. A server **control plane** owns accounts, the workspace registry/metadata, membership, billing, and usage metrics (e.g. how many workspaces exist); the **data plane** (note content) is local-first/P2P. Offline-first applies to the data plane after first sign-in.

**Markdown (+ YAML frontmatter) is the single source of truth.** Search index, link graph, and embeddings are *derived* and must be rebuildable from Markdown alone.

## The Loop (canonical work cycle)

Run this cycle for every change. Do not skip steps, and do not declare a task done mid-loop.

1. **Frame** — Read this file and the relevant code. Write a short task spec with explicit *acceptance criteria* (the observable behavior that proves it's done).
2. **Red** — Add or adjust a test that fails for the right reason (TDD for logic; UI may be verified via build + a targeted check).
3. **Green** — Make the smallest change that passes.
4. **Verify** — Run the gates in order: `typecheck → lint → test → build` (see Verification Gates).
5. **Self-check** — Confirm the domain invariants still hold (see Guardrails). For storage / index / sync / AI / isolation changes this is mandatory, not optional.
6. **Correct** — Any red gate sends you to the Self-correction Protocol. Never proceed on red.
7. **Land** — All gates green and acceptance criteria met → commit one small, reversible step, and **update [`docs/Todo.md`](docs/Todo.md) in the same commit** (see Additional Rules): record the increment, flip its status, refresh *Next up*. Then repeat.

## Verification Gates (Definition of Done)

A task is "done" only when **all** of these pass:

- `pnpm typecheck` — no type errors (also run `cargo check` if the Rust/Tauri core changed).
- `pnpm lint` — clean.
- `pnpm test` — unit and affected integration tests green.
- `pnpm build` — desktop, web, and server all build.
- Domain invariants hold (see Guardrails).
- The task spec's acceptance criteria are demonstrably met.

Run a single test: `pnpm test <file-or-pattern>` (e.g. `pnpm test wikilink`). Keep the scope narrowest while iterating; run the full `pnpm test` before landing.

## Self-correction Protocol

When a gate goes red:

- **Stop and isolate.** Don't stack new changes on a red build. Reproduce the failure minimally.
- **Fix the root cause, not the symptom.** No silencing types, skipping tests, or `try/catch`-to-pass.
- **Re-run the full loop** from *Verify* after each fix.
- **Treat tool output as ground truth.** The type checker and test runner are right; reconcile your mental model to them.
- **If stuck after ~3 attempts:** reduce scope, revert to the last green commit, and re-plan instead of pushing through.

## Guardrails / Invariants (never break these)

Domain truths the loop must preserve. Any change touching storage, indexing, sync, AI, or isolation must self-verify against them.

- **Markdown is the single source of truth.** DuckDB (local) and the GCP store (server) hold only *derived* data and must be fully rebuildable from the Markdown vault.
- **Re-indexing is idempotent.** Running the indexer twice over unchanged input yields identical state.
- **CRDT convergence.** All replicas of a workspace converge to the same state; sync/merge never loses a committed edit, human or AI.
- **Every edit is versioned and revertible** — *especially* AI edits. No edit bypasses history.
- **AI never silently destroys human work.** AI changes flow through the same CRDT + history path and are always reversible.
- **Project isolation is absolute.** A workspace's notes, index, and RAG vector space are isolated. AI retrieval for a project is scoped to that project plus selected *shared* workspaces (read-only). Cross-project read or leakage is forbidden; shared workspaces are the only opt-in bridges.
- **AI respects permissions.** The agent operates strictly within the active workspace's role/permission scope; it cannot read or write outside it.
- **Link integrity.** Renaming or moving a note updates `[[wikilinks]]` and backlinks atomically; no operation leaves dangling-link corruption.
- **Embeddings track content.** When a note changes, its embedding is regenerated or marked stale — never served against outdated text.
- **Offline-first (data plane).** After first sign-in, the desktop app functions with zero connectivity. Peers and the server super-peer are enhancements (sync / web / backup), never hard dependencies for working with your notes.
- **Control plane is server-authoritative.** Accounts, the workspace registry/metadata (incl. `type`), membership, and usage metrics live on the server; never reconstruct them from local state or let a client forge them. Content stays in the data plane.
- **One schema, shared.** The CRDT sync protocol and shared types are defined once in the `shared` package and imported by every client and the server — no hand-duplicated DTOs that can drift.

## Commands

Stable aliases — the loop depends on these names. Implement them at the repo root / via workspace scripts during scaffolding.

- `pnpm install` — install workspace dependencies.
- `pnpm dev` — run the desktop app in dev.
- `pnpm dev:web` — run the web client in dev.
- `pnpm dev:server` — run the sync super-peer / API locally.
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — the individual gates.
- `pnpm test <pattern>` — single / focused test run.
- `pnpm verify` — runs the full gate set (typecheck + lint + test + build).
- `pnpm reindex` — rebuild a workspace's derived stores from Markdown (used to assert the idempotency invariant).

Toolchain: pnpm workspaces · TypeScript (`tsc`) · Biome (lint + format) · Vitest (test) · tsup (build). pnpm 11 gates dependency build scripts — approve them in `pnpm-workspace.yaml` under `allowBuilds`.

## Architecture

Monorepo (pnpm workspaces). Concerns: **desktop**, **web**, **server**, **shared**, **ai**.

- **Desktop (local-first):** Tauri 2 core (Rust) + TypeScript/React UI. Owns the local Markdown vault (source of truth) and a local **DuckDB** index per workspace for full-text search, the link graph, and vector search.
- **Web:** browser client (React) with no local filesystem; reaches a workspace through the server super-peer (WebRTC P2P where possible, relay fallback).
- **Server (control plane + super-peer):** Next.js on GCP (Cloud Run). *Control plane:* accounts/auth (WorkOS AuthKit; per-org BYO LLM keys in GCP Secret Manager), the organization & workspace registry/metadata (incl. `type`), membership/roles, billing, and usage metrics for two distinct audiences — the **service operator** (platform-wide) and the **org admin** (single-org). *Super-peer:* always-on CRDT replica + sync signaling/relay, GCP persistence (Postgres + `pgvector` for the server-side index), and the web gateway.
- **Shared:** Markdown + frontmatter parsing, `[[wikilink]]` / backlink / graph logic, the CRDT sync protocol, and shared TypeScript types — imported by desktop, web, and server so behavior cannot drift.
- **AI:** the on-save agent (auto-link / auto-tag / reorganize), RAG retrieval (per-project, optionally + Shared Knowledge), and the MCP server. Uses the org's BYO key for generation; embeddings run locally/on-device (`multilingual-e5-small` via ONNX Runtime, shared by desktop and server). **The AI participates as a CRDT peer**, so its edits are merge-safe and versioned like any human edit.

**Org model:** `Account → Organization → Workspaces[]`. Every workspace has attributes (`type` `project`/`shared`, `visibility`, `status`, `aiAutonomy`, `ragIncludable` — see AD-7), is one CRDT replication group with an isolated index, and has its own roles (admin / editor / viewer). An org can have several `shared` workspaces; a project includes shared workspaces in its RAG scope via hybrid governance (org-mandated + project opt-in, read-only), never another project. Tenant isolation is **row-level `workspace_id` + Postgres RLS** plus a mandatory scope at the data layer (AD-8).

**Collaboration model:** in-note editing is **real-time** via **Yjs** — each note is raw Markdown in a `Y.Text` edited through **CodeMirror 6**, one Y.Doc per note, with the workspace as the replication boundary; the vault as a whole syncs **asynchronously**. The server-readable authoritative **super-peer is Hocuspocus** (Postgres/S3 persistence; native `yrs` in the Rust core). AI edits ride the same path as a server-side CRDT peer (own identity + `'ai-agent'` transaction origin, applied as diff→minimal ops). See AD-4/AD-5 in `docs/PRODUCT.md`.

**Engine-agnostic versioning:** the CRDT engine lives behind a **thin adapter**; the version-management layer (commits, diff, revert, human/AI attribution, named versions) is built on that adapter contract and is **engine-agnostic** — no Yjs types leak above the boundary, so the engine (Yjs → Loro/Automerge) can be swapped without touching product or history code.

**Data model:** a *note* = Markdown body + YAML frontmatter (id, title, tags, timestamps, workspace). Relationships (`[[wikilinks]]`, backlinks, tags, graph edges) and search/embeddings are *derived* indexes scoped per workspace.

## Conventions

- TypeScript strict mode; no `any` escape hatches used to pass a gate.
- Keep `shared` free of platform-/runtime-specific code so it runs identically in desktop, web, server, and tests.
- Every derived-state code path exposes a deterministic rebuild entrypoint (feeds `pnpm reindex` and the idempotency invariant).
- Any code that reads or retrieves notes must take an explicit workspace scope — there is no ambient "all notes" access (enforces project isolation).
- The CRDT engine is used **only behind a thin adapter**; the version-management layer and all product code depend on the adapter contract, not on Yjs types directly (engine-swappable — see AD-5).

## Additional Rules

1. **Respond in Japanese.**
2. **Commit messages and specs must be written in English.**
3. **Keep [`docs/Todo.md`](docs/Todo.md) current — it is the living progress tracker and the source of *what to do next*.** When choosing work, pick the next task from its **Next up** section (the *Frame* step). When a task lands (gates green, committed), update `Todo.md` **in the same commit**: add the increment to the **Shipped** running log, flip its status marker (`▢`/`⏳`/`◐` → `✅`, per the file's legend), update the **Milestone status at a glance** table when a milestone advances, and adjust **Next up** (remove what's done, re-prioritize, add follow-ups the work surfaced). Record *progress* in `Todo.md`; keep [`docs/ROADMAP.md`](docs/ROADMAP.md) as the stable *plan* (only edit it if the plan itself changes).
