import type { DiffChunk } from "./types"

/**
 * Coarse but correct text diff: shared prefix/suffix as `eq`, the changed middle
 * as `del` + `ins`. M4 swaps in diff-match-patch for granular diffs.
 */
export function textDiff(a: string, b: string): DiffChunk[] {
  const max = Math.min(a.length, b.length)
  let prefix = 0
  while (prefix < max && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < max - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++

  const chunks: DiffChunk[] = []
  const head = a.slice(0, prefix)
  const removed = a.slice(prefix, a.length - suffix)
  const added = b.slice(prefix, b.length - suffix)
  const tail = a.slice(a.length - suffix)

  if (head) chunks.push({ op: "eq", text: head })
  if (removed) chunks.push({ op: "del", text: removed })
  if (added) chunks.push({ op: "ins", text: added })
  if (tail) chunks.push({ op: "eq", text: tail })
  return chunks
}
