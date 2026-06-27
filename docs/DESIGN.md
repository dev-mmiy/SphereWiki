# SphereWiki — Design Plan (Desktop + Web)

> The agreed visual-design plan and decisions. Companion to [`ROADMAP.md`](ROADMAP.md) (milestone
> plan), [`Todo.md`](Todo.md) (live progress), [`PRODUCT.md`](PRODUCT.md) (requirements/decisions),
> and [`../CLAUDE.md`](../CLAUDE.md) (loop & architecture).
>
> **Status: planned.** Phase 0 (direction) is decided; implementation has not started. This is an
> investment *beyond* the MVP's deliberately-low polish bar — data reliability stays the priority.

## Current state (why this plan)

- **No styling exists.** The desktop app has no CSS / Tailwind / styled-components (the `className`s
  in components have no stylesheet behind them); it renders with browser defaults. Functionality is
  complete, visual design is unstarted.
- **No `apps/web` yet.** The desktop currently *is* a Vite/React web build; a separate web client is
  a post-MVP milestone (super-peer gateway). Desktop and web are both React and **share components**,
  so there must be **one** design system, themeable, used by both.
- Layout today is a flat vertical stack of every panel (no sidebar / editor / rail structure).

## Decisions (Phase 0)

| Area | Decision |
|---|---|
| **Layout** | **3-pane** — left: Search + Notes; center: Editor + AI bar; right: a collapsible rail (Links, Backlinks, Tags, Graph, Metrics, History, Ask). |
| **Aesthetic** | **Calm & dense** (Obsidian / Linear leaning): low-chroma surfaces, restrained accent, comfortable for long editing; **light + dark**. |
| **Styling tech** | **CSS design tokens (CSS variables) + lightweight component CSS** (CSS Modules / plain CSS). No UI framework — minimal deps, works offline, light/dark via variables; fits the project's TS + Biome + Vitest + tsup toolchain. |
| **Claude Design** | **Adopt as the design-system hub in Phase 3** — after local tokens + core components exist, host/review/iterate the system on claude.ai/design and keep it in sync with the local component library via `/design-sync` (incremental, one component at a time). |

```
3-pane layout
┌────────┬──────────────────┬──────────┐
│ Search │                  │ Links    │
│ ────── │                  │ Backlnk  │
│ Notes  │     Editor       │ Tags     │
│ • Home │  (CodeMirror)    │ Graph    │
│ • Ideas│                  │ Metrics  │
│ + New  │                  │ History  │
│ Trash  │   [ AI bar ]     │ Ask      │
└────────┴──────────────────┴──────────┘
```

## Principles

- **Calm, dense, long-session-friendly.** Low-chroma backgrounds, one restrained accent, generous
  but not wasteful spacing; information density over decoration (this is a knowledge tool).
- **The AI is visible and trustworthy.** A clear visual language distinguishes **human vs AI** edits
  and makes **revert / diff / kept-vs-reverted** legible — the product's differentiator is that AI
  edits are attributed and one-click revertible, so the design must *show* that.
- **Light + dark**, via CSS variables (`prefers-color-scheme` + a `data-theme` toggle).
- **Offline-first in the design too** — system font stack (no CDN fonts), no runtime style deps.
- **Accessibility** — visible focus rings, sufficient contrast, keyboard paths (the components
  already use semantic HTML + ARIA; keep that).
- **One design system, no drift** — desktop and web import the same tokens + components (the
  "one schema, shared" discipline applied to UI).

## Phases

**Phase 1 — Tokens & theme foundation.** A `tokens.css` (semantic color: bg / surface / text /
muted / accent / border / danger / success / ai; spacing scale; type scale; radii; shadow; z-index),
a `reset.css` + base typography, and light/dark. Wired in `main.tsx`. Tokens start desktop-local
(pure CSS, portable) and move to a shared **`packages/ui` (`@spherewiki/ui`)** when the web client
is built, so both apps share them.

**Phase 2 — Layout & component pass** (one component per Loop). The 3-pane app shell (CSS grid);
the right rail's panels collapsible (`details` / aria). Style the existing components against the
tokens — NoteList, NoteEditor (a CodeMirror theme), the panels, the AI bar, the empty state — and
build the human/AI edit + revert/diff/kept visual language.

**Phase 3 — Claude Design integration.** Confirm the claude.ai login + design scopes, create (or
reuse) a Claude Design project (`DesignSync`), and use `/design-sync` to publish core components as
preview cards and keep local ↔ remote in sync — a living, team-reviewable styleguide.

**Phase 4 — Polish & web.** Accessibility audit (contrast, focus), responsiveness, keyboard nav
(a ⌘K quick-switcher can be added later). When the web-client milestone lands, it reuses
`@spherewiki/ui` unchanged.

## How it's built

- Each phase / component is a normal **Loop** increment (typecheck → lint → test → build green) and
  updates [`Todo.md`](Todo.md) on landing (per CLAUDE.md rule 3).
- CSS itself isn't unit-tested; correctness stays covered by the components' existing
  structure / render / ARIA tests, which must keep passing through restyling.
- Scope: desktop first (it's the live web build); the web client reuses the same system later.
