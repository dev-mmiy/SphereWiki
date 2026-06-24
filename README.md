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

Current state: **M1 complete** — `packages/shared` core landed (Markdown/frontmatter, wikilinks/backlinks/graph, the Yjs CRDT adapter, and the engine-agnostic versioning layer). See [docs/ROADMAP.md](docs/ROADMAP.md).
