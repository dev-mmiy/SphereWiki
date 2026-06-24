import type { NoteId } from "@spherewiki/shared"

/**
 * Suggestion seam (M4a). Suggestions are INERT data: they carry no `apply()`, so
 * neither the heuristic provider nor a future Claude-backed one can mutate a note.
 * Only the on-save agent applies them, through the CRDT + version path — which is
 * how "AI never silently destroys human work" is enforced structurally.
 */

/** A note as seen by the suggester: its id, title, and full document text. */
export interface NoteContext {
  readonly id: NoteId
  readonly title: string
  readonly body: string
}

export interface LinkSuggestion {
  readonly kind: "link"
  /** The target note's canonical title, used verbatim as the `[[wikilink]]` target. */
  readonly title: string
  readonly targetId: NoteId
}

export interface TagSuggestion {
  readonly kind: "tag"
  readonly tag: string
}

export interface NoteSuggestions {
  readonly links: readonly LinkSuggestion[]
  readonly tags: readonly TagSuggestion[]
}

export interface SuggestionRequest {
  readonly note: NoteContext
  /** Other notes in the SAME workspace scope (caller-scoped — never cross-project). */
  readonly siblings: readonly NoteContext[]
}

export interface SuggestionProvider {
  suggest(request: SuggestionRequest): Promise<NoteSuggestions>
}
