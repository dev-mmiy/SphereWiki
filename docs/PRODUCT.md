# SphereWiki — Product Requirements

> **One-liner:** A team knowledge base where people and AI grow the wiki together — local-first, Obsidian-style, with AI that actively maintains the graph.

This document is the product/requirements source of truth. Operational guidance for working in the codebase lives in [`../CLAUDE.md`](../CLAUDE.md); the MVP scope and milestone plan live in [`ROADMAP.md`](ROADMAP.md).

## 1. Target & Differentiation

- **Target:** teams and organizations building a shared knowledge base.
- **Primary differentiator:** **the AI actively grows the knowledge base.** On every save it auto-links related notes, auto-tags, and reorganizes — the graph improves itself rather than relying on manual gardening.
- **Supporting pillars:** local-first with seamless multi-device/team sync; everything (human or AI edit) versioned and revertible; the wiki is reachable by external AI agents via MCP.

## 2. Core Concepts

```
Account (per user; required to use the app, even locally)
Organization (company; billing & membership boundary)
└─ Workspaces[] — each carries a `type` attribute (extensible):
   ├─ Project workspace   (type: project) — isolated vault / index / RAG space / roles
   ├─ Project workspace   (type: project) — isolated …
   ├─ Shared workspace    (type: shared)  — org-wide common knowledge
   └─ Shared workspace    (type: shared)  — there may be several, e.g. "Company-wide", "Design system", "Legal"
```

- **Account** — every user must create an account to use SphereWiki (required even for local-first/free use; see §3.8). Identity, login, and org/workspace membership hang off the account.
- **Organization** — the company. Owns subscription, members, and identity/SSO.
- **Workspace** — an isolated unit of knowledge with its own Markdown vault, derived index, RAG vector space, CRDT replication group, and roles. Attributes (extensible): **`type`** (`project`/`shared`), **`visibility`** (`private`/`org`/`public`), **`status`** (`active`/`archived`), **`aiAutonomy`** (on-save AI `off`/`suggest`/`auto`), and **`ragIncludable`** (shared workspaces only). See AD-7.
- **Project workspace** (`type: project`) — knowledge for one project; fully isolated from other projects.
- **Shared workspace** (`type: shared`) — org-wide common knowledge. **There can be several.** Any project may pull selected shared workspaces into its RAG scope **read-only**; editing is governed by each shared workspace's own roles.
- **Note** — a Markdown file + YAML frontmatter (id, title, tags, timestamps, workspace). The single source of truth.

## 3. Functional Requirements

### 3.1 Editing & collaboration
- Markdown editing with `[[wikilinks]]`, backlinks, tags, and a graph view.
- **In-note editing is real-time** (multiple humans + AI co-edit a note live, CRDT-based).
- **The vault as a whole syncs asynchronously** (offline edits merge on reconnect).

### 3.2 AI capabilities
- **On-save agent (core):** when a note is saved, the AI auto-links, auto-tags, and reorganizes.
- **Agentic auto-edit:** AI can create, update, and restructure notes autonomously.
- **RAG:** natural-language Q&A grounded in the workspace's notes, with citations.
- **MCP:** the vault is exposed as MCP tools (search / read / write) so external agents can use SphereWiki directly.
- **Control model:** AI edits apply **directly** (no approval gate) but every change is versioned and revertible.

### 3.3 Version history
- Git-like history of every change, human or AI; diff view and one-click revert.
- AI edits are clearly attributed and never bypass history.

### 3.4 Workspace isolation & RAG scoping
- Each project's notes, index, and **RAG vector space are isolated**.
- AI read scope for a project = that project **+ selected shared workspaces** (read-only).
- **Cross-project access is forbidden** — AI in project A can never read another project. Shared workspaces are the only explicit, opt-in bridges.
- Inclusion is **hybrid** (AD-6): org admins mark some shared workspaces **mandatory** (auto-included everywhere); project admins **opt in** to others.

### 3.5 Permissions & roles
- **Org roles** (owner/admin) + **per-workspace roles** (admin / editor / viewer).
- Users only see and sync workspaces they belong to.

### 3.6 Content ingestion
- Markdown (native), plus **PDF/Office documents** and **images (OCR / captioning)** — ingested, indexed, and made retrievable by RAG.

### 3.7 Search
- Keyword (full-text) + semantic (vector) search, scoped per workspace; graph navigation.

### 3.8 Accounts & identity
- **An account is required to use SphereWiki**, including local-first/free use.
- Sign-up and first sign-in need connectivity; afterwards the desktop app works offline with a cached session and re-validates when online.
- An account carries the user's organization and per-workspace memberships.

### 3.9 Administration (two distinct roles)

These are **separate** concerns with separate audiences, surfaces, and scopes:

- **Service operator (SphereWiki, us) — operator/management plane.** Cross-tenant operational view: total accounts and organizations, **how many workspaces exist / are being created**, aggregate activity and system health, plus support/abuse tooling. Scope = the whole platform. Never includes note content.
- **Organization administrator (customer) — org admin.** Manages a single organization: its workspaces (create/archive), members and roles, shared-workspace governance, and the org's subscription/BYO-key. Scope = their own org only.

Both read from the server-side **control plane** (see §5); neither derives from note bodies (which stay local-first/P2P).

## 4. Platforms
- **Desktop (all OS: macOS / Windows / Linux)** via Tauri — the local-first client.
- **Web app (browser)** — install-free team access via the server super-peer.
- (Mobile / CLI / API: out of scope for MVP.)

## 5. Sync & Data Architecture

The system splits into two planes:

- **Control plane (server-authoritative, online):** accounts, organizations, the **workspace registry & metadata** (including each workspace's `type` attribute), membership/roles, billing, and **usage metrics** serving two distinct audiences — the **service operator** (platform-wide) and the **org admin** (single-org). This is how the operator learns how many workspaces exist.
- **Data plane (local-first + P2P):** the actual note content. Markdown is the source of truth, locally stored and peer-replicated. For MVP the super-peer is **server-readable** (encrypted in transit + at rest; server-managed keys) so it can run the on-save AI agent, RAG, and the web path; a future E2E + per-org trusted-worker mode is kept open (see AD-1 in §10).

Details:
- **Source of truth:** Markdown + YAML frontmatter. All search/graph/embedding data is derived and rebuildable from it.
- **Local store:** DuckDB on desktop (FTS, graph, vectors).
- **Server store:** GCP database (Postgres + `pgvector`) for the control plane, the server-side index, and persistence.
- **Sync:** **P2P-first** among workspace members via CRDT. The subscription server is an **always-on super-peer**: signaling, WebRTC relay fallback, persistence/backup, and the gateway for web clients (which can't run pure P2P).
- **AI as a peer:** the on-save agent joins the workspace CRDT as a participant, so its edits merge and version like any human's.

## 6. AI & Privacy
- **BYO-key:** each organization supplies its own LLM API key. **Claude** (latest models) for generation/agents.
- **Embeddings run locally/on-device** via **`multilingual-e5-small`** on ONNX Runtime, shared by desktop and server (see AD-2 in §10) — no extra provider key required. (Note: Claude models do not produce embeddings, which is why generation and embedding are split.)
- **Cost model:** the subscription covers the product (agents, sync, collaboration); LLM token cost passes through to the org's own key.

## 7. Monetization
- **An account is always required** (even for free local use).
- **Subscription includes** sync + collaboration + AI features.
- **Local single-user use is free** (account required); fully offline after first sign-in.
- LLM token cost is the org's (BYO-key pass-through), separate from the subscription.

## 8. Key Invariants (mirrored as guardrails in CLAUDE.md)
- Markdown is the single source of truth; derived stores are rebuildable.
- Re-indexing is idempotent.
- CRDT replicas converge; no committed edit (human or AI) is ever lost.
- Every edit — especially AI's — is versioned and revertible.
- Project isolation is absolute; no cross-project read/leakage. Shared workspaces are the only opt-in, read-only bridges.
- AI operates only within the active workspace's permission scope.
- The control plane is server-authoritative (accounts, workspace registry/metadata, metrics); content lives in the data plane.
- Offline-first (data plane): the desktop app works with zero connectivity after first sign-in.

## 9. Open Decisions

**All resolved** for this design phase — see §10 (AD-1 … AD-8). New questions will be appended here as implementation surfaces them.

## 10. Architecture Decisions (resolved)

Decisions made during design; each closes an item from §9.

- **AD-1 — Data-plane privacy & AI execution (was §9.1, §9.5).** **Server-readable content + server-side AI.** The super-peer can read note plaintext (encrypted in transit + at rest, server-managed keys) and runs the on-save AI agent, RAG, and web rendering for all clients. The content store and AI-execution layers are abstracted so a future **E2E + per-org trusted-worker** mode (the earlier "Option C") can be added without rearchitecting. *Why:* fastest path to a working Web + consistent AI behavior, while keeping the strong-privacy endgame open.
- **AD-2 — On-device embedding model (was §9.4).** **`multilingual-e5-small`** (384-dim, ~118M params, MIT) via **ONNX Runtime** — the `ort` crate in the Tauri Rust core and `onnxruntime-node` on the server, so desktop and server share one model file and a cosine-compatible vector space. Japanese retrieval quality is on par with `-base` at a fraction of the size/storage. *Contract:* pin the model artifact, tokenizer, pooling, and fp32 precision; add a CI conformance test asserting Rust and Node embeddings match within ~1e-4; re-index on any model/precision change (versioned embedding tag). *Upgrade path:* `bge-m3` if long-context / higher Japanese quality is later required.
- **AD-3 — Auth / identity (was §9.7).** **WorkOS AuthKit.** B2B Organizations + org-scoped RBAC map the two admin roles (service operator = env-level role + Impersonation for support; org admin = org-scoped role). SSO/SAML + SCIM are self-serve, so enterprise is never blocked. Desktop uses Authorization Code + PKCE (system browser via loopback/deep-link), OS-keychain token storage, and **offline JWKS validation** (cache JWT + JWKS, longer token TTL = a deliberate trusted offline grace window; single-flight refresh on reconnect). Per-org **BYO LLM key → GCP Secret Manager** (never the IdP); **Stripe customer = organization**. Free to ~1M MAU.
- **AD-4 — CRDT stack, editor & Markdown representation (was §9.2/§9.3).** **Yjs + CodeMirror 6 (`y-codemirror.next`), each note stored as raw Markdown in a single `Y.Text`** (byte-exact `.md`, upholding "Markdown is the source of truth"). Granularity: **one Y.Doc per note** (in-note real-time); the **workspace is the replication boundary** (whole-vault sync is async). Server-readable authoritative **super-peer = Hocuspocus** (Postgres/S3 persistence; `onChange`/origin hooks drive & tag the AI); native **`yrs`** in the Tauri/Rust core and server (binary-compatible with JS Yjs; never `ywasm`). **History:** docs run `gc=false` + `Y.PermanentUserData`; persist `Y.snapshot` per version; diff via `{snapshot, prevSnapshot}`; revert via `createDocFromSnapshot`; tombstone memory mitigated by per-note granularity. **AI as peer:** server-side `yrs` peer with its own awareness identity + `'ai-agent'` transaction origin, editing via **diff→minimal insert/delete** (`diff-match-patch` with `cleanupSemantic`), re-diffed against the live doc. *Watch items:* explicitly test Japanese/IME co-editing (CM6 handles IME in-core; suspend remote-apply during composition if needed); convert UTF-16↔UTF-8 index units between JS and the Rust super-peer; Yjs single-maintainer risk (mitigated by AD-5).
- **AD-5 — Engine-agnostic versioning over a thin CRDT adapter.** The CRDT engine sits behind a **thin adapter** exposing a minimal contract (open/load doc, apply local edit, merge remote update, subscribe to changes, **snapshot / restore**, identity+origin tagging, read current text). The **version-management layer** (commits, diff, revert, human-vs-AI attribution, named versions, timeline) is built **on top of that adapter contract and is engine-agnostic** — no Yjs types leak above the boundary. Yjs is the first adapter (snapshots via `gc=false` + `Y.snapshot`); **Loro and Automerge remain drop-in alternatives** (Loro maps especially cleanly via native `checkout`/`revertTo`). *Why:* keep engine dependency thin so the CRDT engine can be swapped without touching product code or history semantics — the hedge for AD-4's maturity/single-maintainer risk.
- **AD-6 — Shared workspace governance & RAG inclusion (was §9.6).** Shared workspaces use the **same role model** as any workspace (admin/editor/viewer). RAG inclusion is **hybrid**: the **org admin can mark certain shared workspaces as mandatory** (auto-included in every project's RAG scope), and **project admins may additionally opt in** to other shared workspaces. Cross-project inclusion stays forbidden; shared workspaces are the only bridges, read-only.
- **AD-7 — Workspace attributes (was §9.8).** Beyond `type` (`project`/`shared`), every workspace carries: **`visibility`** (`private` / `org` / `public`), **`status`** (`active` / `archived`; archived = excluded from sync and AI processing), **`aiAutonomy`** (on-save AI: `off` / `suggest` / `auto`, plus strength), and — for `type: shared` — **`ragIncludable`** (whether projects may pull it into RAG). The attribute set is extensible.
- **AD-8 — GCP database & tenant isolation (was §9.9).** **Cloud SQL for PostgreSQL + `pgvector`** for the control plane, server-side index, and persistence; **GCS** for Markdown blobs / attachments / snapshots. Tenant isolation is **row-level**: every row carries `workspace_id`, enforced by **Postgres Row-Level Security** *and* a mandatory workspace-scope at the data-access layer (defense in depth for the "project isolation is absolute" invariant). *Upgrade path:* AlloyDB if vector/scale performance demands it; schema- or DB-per-tenant if a customer requires physical isolation.
