/**
 * A `Note N` title guaranteed NOT to collide with any existing note title. The workspace's `create`
 * resolves-or-restores by title (a `[[wikilink]]` click should open the existing note, not duplicate
 * it) — but an EXPLICIT "new note" / "new note in this folder" action must always CREATE. A naive
 * `Note ${count + 1}` collides after deletes/renames (the count drifts from the highest `Note N` on
 * disk), and the collision makes the action resolve to that OTHER note (in another folder) instead of
 * creating where the user clicked. Picking the smallest free `Note N` avoids the resolve entirely.
 */
export function freshNoteTitle(existingTitles: Iterable<string>): string {
  const taken = new Set(existingTitles)
  let n = 1
  while (taken.has(`Note ${n}`)) n++
  return `Note ${n}`
}
