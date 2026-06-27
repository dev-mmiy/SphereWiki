/**
 * Core domain types shared across the app. Platform-free.
 */

/** Branded id types so workspace and note ids can't be accidentally mixed. */
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" }
export type NoteId = string & { readonly __brand: "NoteId" }

export const asWorkspaceId = (id: string): WorkspaceId => id as WorkspaceId
export const asNoteId = (id: string): NoteId => id as NoteId

/** Parsed YAML frontmatter. Arbitrary keys; common ones: title, tags, timestamps. */
export type Frontmatter = Record<string, unknown>

/** A note split into its parsed frontmatter and its raw Markdown body. */
export interface ParsedNote {
  readonly frontmatter: Frontmatter
  readonly body: string
}

/** A single `[[wikilink]]` occurrence parsed from Markdown body text. */
export interface WikiLink {
  /** Target note name/path as written, before any `#anchor` or `|alias`. */
  readonly target: string
  /** Optional display alias: `[[target|alias]]`. */
  readonly alias?: string
  /** Optional heading/block anchor: `[[target#anchor]]`. */
  readonly anchor?: string
  /** Full matched text, e.g. `[[target|alias]]`. */
  readonly raw: string
  /** Character offset of the link start within the body. */
  readonly start: number
  /** Character offset just past the link end. */
  readonly end: number
}

/** Derived link graph for a set of notes. Rebuildable from Markdown alone. */
export interface LinkGraph {
  /** note id -> set of wikilink targets it references */
  readonly outgoing: ReadonlyMap<string, ReadonlySet<string>>
  /** wikilink target -> set of note ids that reference it (backlinks) */
  readonly backlinks: ReadonlyMap<string, ReadonlySet<string>>
}

/** Derived tag index for a set of notes. Tags live in frontmatter; rebuildable from Markdown alone. */
export interface TagIndex {
  /** tag -> set of note ids that carry it */
  readonly byTag: ReadonlyMap<string, ReadonlySet<string>>
  /** note id -> its tags, in document order */
  readonly byNote: ReadonlyMap<string, readonly string[]>
}

/** One node in the graph view. */
export interface GraphNode {
  readonly id: string
  readonly title: string
  /**
   * Present only on a "ghost" node — a dangling `[[link]]` target that has no note yet, surfaced
   * (opt-in) so the graph shows the wiki's unwritten frontier and the node can be created. A real
   * note omits this field, so `{id, title}` nodes stay byte-identical to the pre-ghost model.
   */
  readonly kind?: "dangling"
}

/** A directed note→note connection: a `[[wikilink]]` whose target title resolved to a real note. */
export interface GraphEdge {
  /** source note id */
  readonly from: string
  /** target note id */
  readonly to: string
}

/**
 * A renderable node/edge model of a workspace's notes and their wikilink relationships
 * (the "basic graph view"). Derived from Markdown — rebuildable, and workspace-scoped by
 * construction (it only ever contains the notes handed to `buildGraphModel`).
 */
export interface GraphModel {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

/** One note's searchable terms (derived from its title, body, and tags). */
export interface SearchIndexEntry {
  readonly title: string
  /** body + tag term -> occurrence count */
  readonly terms: ReadonlyMap<string, number>
  /** distinct title terms (matches here are boosted) */
  readonly titleTerms: ReadonlySet<string>
}

/**
 * A derived full-text index for a set of notes. Rebuildable from Markdown alone and
 * workspace-scoped by construction (only the notes handed to `buildSearchIndex`). The
 * in-memory implementation backs the desktop today; DuckDB FTS slots in behind it at M2b.
 */
export interface SearchIndex {
  readonly byNote: ReadonlyMap<string, SearchIndexEntry>
}

/** One ranked search result. */
export interface SearchHit {
  readonly id: string
  readonly title: string
  readonly score: number
}

/**
 * A derived, point-in-time summary of a workspace's graph growth — the dogfooding signal that
 * "the note graph measurably grows." All counts are visible-scoped (trashed notes excluded) and
 * rebuildable from Markdown, so the same inputs always yield the same numbers.
 */
export interface WorkspaceMetrics {
  /** Visible notes. */
  readonly notes: number
  /** Resolved note→note `[[wikilink]]` edges (deduped, self-links excluded). */
  readonly links: number
  /** Edges to referenced-but-uncreated notes — the unwritten frontier. */
  readonly unwrittenLinks: number
  /** Distinct tags in use across visible notes. */
  readonly tags: number
  /** Visible notes carrying at least one tag. */
  readonly taggedNotes: number
}
