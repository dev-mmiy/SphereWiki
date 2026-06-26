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

/** One note in the graph view. */
export interface GraphNode {
  readonly id: string
  readonly title: string
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
