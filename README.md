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

Current state: **M2a (editor-first) complete** — the desktop app runs as a Vite/React web build with the CodeMirror↔Yjs editor, a multi-note vault, wikilink/backlinks navigation, and commit/diff/revert history (`pnpm dev`). Native shell + on-disk `.md` vault + DuckDB search (Tauri/Rust) are the deferred **M2b**. See [docs/ROADMAP.md](docs/ROADMAP.md).
