import type { GraphModel, TagIndex, WorkspaceMetrics } from "./types"

/**
 * Summarize a workspace's graph growth from its derived graph model and tag index — the
 * dogfooding signal that the note graph is growing, and how connected / organized it is. Pure and
 * deterministic; counts are visible-scoped (ghost/dangling nodes are the frontier, never counted
 * as notes; tag counts come only from real notes, so trashed notes never inflate them). Pass a
 * graph built with `{ includeDangling: true }` so `unwrittenLinks` reflects the frontier.
 */
export function buildWorkspaceMetrics(graph: GraphModel, tags: TagIndex): WorkspaceMetrics {
  const ghostIds = new Set<string>()
  const realNoteIds: string[] = []
  for (const node of graph.nodes) {
    if (node.kind === "dangling") ghostIds.add(node.id)
    else realNoteIds.push(node.id)
  }

  let links = 0
  let unwrittenLinks = 0
  for (const edge of graph.edges) {
    if (ghostIds.has(edge.to)) unwrittenLinks++
    else links++
  }

  const distinctTags = new Set<string>()
  let taggedNotes = 0
  for (const id of realNoteIds) {
    const noteTags = tags.byNote.get(id)
    if (noteTags !== undefined && noteTags.length > 0) {
      taggedNotes++
      for (const tag of noteTags) distinctTags.add(tag)
    }
  }

  return {
    notes: realNoteIds.length,
    links,
    unwrittenLinks,
    tags: distinctTags.size,
    taggedNotes,
  }
}
