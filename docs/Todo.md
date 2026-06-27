# SphereWiki — Todo & Progress

> Living status tracker. The **plan** lives in [`ROADMAP.md`](ROADMAP.md) (MVP scope, milestones
> M0–M5, post-MVP); the **decisions** in [`PRODUCT.md`](PRODUCT.md); the **loop & architecture** in
> [`../CLAUDE.md`](../CLAUDE.md). This file tracks what is **done**, what is **deferred (and why)**,
> and **what to do next** — from here to the MVP release and beyond.
>
> Legend: ✅ done · ◐ partial (local/seam done, rest deferred) · ⏳ deferred (credentials / toolchain) · ▢ not started

## Milestone status at a glance

| Milestone | Status | Note |
|---|---|---|
| **M0** Foundations & the Loop | ✅ | pnpm monorepo, stable command aliases, gates green, loop runnable |
| **M1** `shared` core (offline, pure) | ✅ | Markdown/frontmatter, wikilink/backlink/graph, CRDT adapter + version layer |
| **M2a** Desktop editor (editor-first) | ✅ | runs as a Vite/React web build (`pnpm dev`) |
| **M2b** Native shell + on-disk vault + DuckDB | ⏳ | needs the Rust/Tauri toolchain |
| **M3a** Sync / persistence / auth seams | ✅ | in-memory, swappable, unit-tested |
| **M3b** Real WS super-peer + durable storage + app sync | ◐ | local done over real sockets; cloud control plane deferred (credentials) |
| **M4a** On-save AI agent + RAG (local) | ✅ | heuristic suggester + deterministic embedder/answerer, no credentials |
| **M4b** Real AI backends (ONNX / pgvector / Claude) | ⏳ | needs a model download + a Claude key |
| **M5** Dogfood hardening + success instrumentation | ▢ | the next major phase toward MVP exit |

**Where we are:** every *local, no-credentials* slice of MVP capability is in place. The desktop app
runs as a web build (`pnpm dev`) with the CodeMirror↔Yjs editor, a multi-note vault, wikilinks /
backlinks / graph, full-text search, tags (human **and** AI), history / diff / revert, local-first
persistence + live P2P sync, and the local AI on-save agent + RAG. What remains is
**credential-/toolchain-gated** (cloud, real AI backends, native shell) plus **M5 dogfood hardening**.

---

## Shipped — local, no-credentials increments (running log)

Each landed green on all loop gates (`pnpm verify`); the items below began as the S1/S2 storage & sync
follow-ups and grew to span Notes / AI / sync hardening. Full detail is in the git history.

### Storage & sync
- ✅ **S3a — Durable local vault.** The desktop vault persists to `localStorage` (`createLocalStorageVault`, behind the `Vault` seam); the note list + Markdown survive a reload offline (degrades to in-memory if storage is unavailable). Note ids stay stable across reloads so sync room names don't drift.
- ✅ **S3b — Offline-first synced rooms.** A synced room caches its CRDT state locally (`ConnectLocalPersistence` → `connectLocalPersistence`, backed by y-indexeddb): on open the last-synced state loads from IndexedDB (readable offline, no server), then the super-peer merges live edits on top. The vault is never clobbered (empty-doc write guard); seeding stays server-authoritative. *Remaining:* an **uncached empty synced room** shows an empty editor until the server/cache provides content — needs server-arbitrated seed-once.
- ✅ **S4a — Note-registry CRDT.** Engine-agnostic `CrdtRegistry` / `openYjsRegistry` (per-workspace map note id → `{title}`), distinct from each note's body `CrdtNote`. Convergent, idempotent, remote-flagged, with a read-boundary guard dropping malformed remote entries.
- ✅ **S4b-1 — Collision-resistant note ids.** New notes get `crypto.randomUUID` ids (seeds included); legacy `n*` ids migrate on load before any room joins, so two peers can't mint the same id. Plus `Vault.ensure(id, title, body?)` (insert-if-absent, never overwrites a body).
- ✅ **S4b-2 — Note list converges across peers.** The registry syncs over `${ws}/__registry__` via `ConnectRegistry` / `ConnectRegistryPersistence` (IndexedDB cache + offline). Reconcile is registry→vault **add-only** (never removes a local note), the list is union-additive (registry title wins), seeding stays server-authoritative (no double-seed). Adversarial-reviewed; 0 real findings.
- ✅ **S4c — Revertible synced delete.** A delete is a registry soft-delete tombstone (`RegistryEntry.deleted`): hides the note across peers but keeps the Markdown body, so it's restorable (a "Trash" with Restore) and a peer delete can't silently destroy work. Deleting the active/last note moves to a visible note rather than leaving an editable trashed note. Adversarial-reviewed; the one real finding fixed + regression-tested.
- ✅ **S4d — Link-integrity-preserving rename.** Because wikilinks resolve by *title*, rename updates the title **and atomically repoints every `[[old title]]` backlink** (preserving `|alias`/`#anchor`) — no dangling link left behind (`renameWikiLinkTargets`, pure, literal-matched). Title → registry (LWW); open note's body rewrite rides its CRDT doc; duplicate-title rename refused. Adversarial-reviewed (4 dimensions). *Bounds:* title is a registry-level edit (reversed by renaming back); in sync mode a non-open note's body rewrite stays local until reopened (pending multi-doc sync).
- ✅ **Persistence compaction.** Version snapshots compacted to **visible content** (round-trip through a `gc:true` doc) instead of full tombstone-bloated `encodeStateAsUpdate` copies — a churn-heavy snapshot drops ~250×, bounded by content not churn. Self-contained restore points preserved (revert/diff/open unchanged); the live doc's `gc:false` (AD-4) and the sync path are untouched. *Deferred:* true delta-encoded history (`Y.snapshot` + `createDocFromSnapshot`).
- ◐ **Room-level authorization — server enforcement seam.** `createSyncServer({ authorize })` wires Hocuspocus `onAuthenticate`: when set, a join must present a token the `RoomAuthorizer` accepts **for the exact room**, or it's rejected. Transport-level enforcement of project isolation / permissions beneath room naming; defaults **open** (zero-config local). Verified over real sockets (accept / deny / wrong-room). *Deferred (credentials):* WorkOS-issued workspace-scoped token + desktop token threading (`ServerSyncOptions.token`).

### Notes / navigation
- ✅ **Basic graph view.** `buildGraphModel(notes, linkGraph)` → node/edge model (one node per visible note; an edge per `[[wikilink]]` whose target title resolves to a note id; dangling + self-links dropped; edges deduped). Derived from Markdown, workspace-scoped by construction. Desktop `GraphView`: SVG, deterministic circular layout, click-to-navigate, active node highlighted.
- ✅ **Full-text note search.** `buildSearchIndex` + `searchNotes` over title + parsed body + tags; prefix-match, AND across terms, title-boosted, deterministic order. Workspace-scoped + visible-notes-only (trash excluded). Desktop `SearchPanel`. The in-memory index is the seam **DuckDB FTS** slots into at M2b.
- ✅ **Create-on-click for dangling links.** An outgoing link with no target note (`OutgoingLink {title, exists:false}`) renders as a **"+ create"** affordance in the Links panel; clicking it creates the note via the registry-synced `create` path, which immediately resolves the link (graph edge + backlinks light up). Write-permission-gated.
- ✅ **Ghost nodes in the graph.** Dangling targets also appear in the graph as opt-in dashed "ghost" nodes (`buildGraphModel(..., {includeDangling})`), surfacing the wiki's referenced-but-unwritten **frontier**; clicking one creates the note. Adversarial-reviewed (3 dimensions; 6 findings fixed) — notably `create()` is now **resolve-or-restore** (selects an existing visible note / restores a trashed one rather than minting a duplicate), and ghost ids are collision-proof.

### AI / co-editing
- ✅ **Human tag curation.** The Tags panel lets an editor **add** / **remove** tags (per-tag `×` + a form), so people and AI co-curate the same tags; edits ride the note's CRDT doc (attributed, synced, revertible) and the panel updates live. Write-permission-gated. Adversarial-reviewed (2 dimensions; 5 findings fixed) — `addNoteTag`/`removeNoteTag` edit frontmatter **surgically via the YAML Document API** (sibling keys / scalars / comments preserved), and tag edits **no-op until a synced note hydrates** (prevents pre-hydration frontmatter corruption).
- ✅ **Frontmatter-preserving AI edits.** The on-save agent's auto-link/auto-tag no longer re-serializes the whole frontmatter: `applyTagSuggestions` delegates to `addNoteTag`, and `buildAgentEdit` applies links via a new shared **`withNoteBody`** (body-only edit, frontmatter text preserved byte-for-byte). Closes the M4a *frontmatter canonicalization* limitation codebase-wide. Backed by shared `splitFrontmatter` / `withNoteBody`.

---

## Known limitations & documented bounds (bounded, behind seams)

Surfaced by adversarial review; each is additive and lands behind the existing seams.

- ✅ **Frontmatter canonicalization — resolved.** Both manual (`addNoteTag`/`removeNoteTag`) and AI (`applyTagSuggestions`/`buildAgentEdit`) tag/link edits now preserve sibling frontmatter scalars + comments. *Residual:* the YAML serializer still canonicalizes leading-zero/octal integer literals (`007`), which never occur in SphereWiki frontmatter (ids are UUIDs, timestamps ISO strings).
- ⏳ **Runtime read-only shared indexes** → M4b. `ReadonlyVectorIndex` is read-only at the type level only; real backends (+ a frozen projection) enforce it at runtime.
- ⏳ **Shared-bridge type enforcement** → M4b. The RAG retriever trusts the caller that a passed `shared` index is `shared`-type; M4b carries workspace `type` + Postgres RLS so "never another project" is checked, not conventional.
- ⏳ **Citation id namespacing** → M4b. `readBody` resolves by bare `NoteId`; M4b namespaces ids per workspace so a cross-workspace id collision can't source citation text out of scope.
- ⏳ **Title-metadata staleness** → M4b. The embedding/staleness key is body-only (so tag edits don't churn the vector); a rename leaves a stale stored title until re-embed.
- ⏳ **CJK / space-less auto-link** → M4b. The heuristic's letter-class word boundaries rarely fire for scripts without inter-word spaces; the Claude suggester (or a segmenter) handles these.

---

## Deferred — credentials / toolchain (not startable locally)

- ⏳ **M2b — Native shell & persistence (Rust/Tauri).** Tauri 2 wrap; on-disk Markdown vault (file-backed `Vault` behind the existing seam); DuckDB local index (FTS / graph / vectors) + idempotent `reindex`.
- ⏳ **M3b cloud control plane (credentials).** WorkOS AuthKit (auth seam); Cloud SQL + `pgvector` + GCS (persistence seam); Postgres RLS for DB-level isolation. *Done-when:* desktop/web sync against the **deployed** server with real accounts, and cross-workspace access is provably blocked at the DB.
- ◐ **Room-auth token issuance (credentials).** The WorkOS-issued, workspace-scoped token the `RoomAuthorizer` verifies + threading it from the desktop through the connect seams (`ServerSyncOptions.token` → provider). The production super-peer leaves `authorize` unset until then.
- ⏳ **M4b — Real AI backends (credentials + download).** multilingual-e5-small (ONNX) embedder (+ forced reindex); pgvector (server) / DuckDB (desktop) vector backends with RLS; Claude-backed suggester + answerer (BYO key via Secret Manager); the server-side agent as a Hocuspocus CRDT peer. All behind the unchanged M4a seams.

---

## Next up

### Local-testable now (no credentials)
1. **M5 — success-criteria instrumentation.** Make the central-hypothesis metrics measurable: AI suggestions **kept-vs-reverted** (target ≥ ~70% kept) and **graph growth** (links/notes per week, AI contribution visible). Needs a way to record when an AI version is reverted vs kept + a small metrics readout. *High value — gates MVP exit.*
2. **M5 — reliability hardening.** Stress the data invariants the MVP can't compromise: no lost edits under concurrent sync, revert always works, isolation holds. Add convergence/property tests and an onboarding pass.
3. **Polish candidates (smaller, optional):** wikilink autocomplete in the editor (`[[` → title suggestions); a Cmd-K quick-switcher over the existing search; surfacing the AI "suggest" autonomy mode (review-before-apply) in the UI; client-side room-auth token threading (inert until WorkOS, but readies the seam).

### Gated — unblock when the dependency is available
- **Deploy the server + WorkOS** → finishes M3b's remaining done-when (real accounts, DB-enforced isolation) and lets the room-auth token path go live.
- **Model download + Claude key** → M4b real AI backends (the desktop "Organize with AI" + RAG already wired, will pick up real providers).
- **A Rust/Tauri session** → M2b native shell + on-disk `.md` vault + DuckDB.

### Toward the MVP release (M5 exit)
- A small team dogfoods SphereWiki as its real knowledge base for ≥ 3–4 weeks, with the success criteria in [`ROADMAP.md`](ROADMAP.md) measurable (kept-vs-reverted, graph growth, no lost edits, trust in revertible AI edits).

---

## After the release — Post-MVP (indicative order, from ROADMAP)

1. ▢ **Real-time co-editing** — presence / cursors on the existing Yjs base.
2. ▢ **Web client** — via the super-peer gateway.
3. ▢ **Content ingestion** — PDF / Office, then image OCR / captioning.
4. ▢ **Multi-project depth** — shared-workspace governance UI, more workspace attributes.
5. ▢ **MCP server** — expose the vault to external agents.
6. ▢ **Billing** — Stripe subscription (customer = org).
7. ▢ **Privacy endgame** — E2E + per-org trusted worker (AD-1).
8. ▢ **Later** — mobile, SSO/SCIM, AlloyDB if scale demands.
