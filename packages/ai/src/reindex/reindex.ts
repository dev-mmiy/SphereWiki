import { parseNote, type Vault } from "@spherewiki/shared"
import { contentHash } from "../embedding/hash"
import type { EmbeddingProvider } from "../embedding/types"
import type { VectorIndex } from "../index-store/types"

/**
 * Rebuild a workspace's vector index from its Markdown vault. Reads ONLY Markdown
 * (single source of truth) and is idempotent: a note whose body hash already
 * matches is skipped, and notes absent from the vault are pruned — so running it
 * twice over unchanged Markdown yields identical index state. Feeds `pnpm reindex`.
 */

export interface ReindexInput {
  readonly vault: Vault
  readonly index: VectorIndex
  readonly embedder: EmbeddingProvider
  /** Re-embed every note even when its hash is unchanged (e.g. after a model swap). */
  readonly force?: boolean
}

export interface ReindexReport {
  readonly embedded: number
  readonly skipped: number
  readonly removed: number
}

export async function reindexWorkspace(input: ReindexInput): Promise<ReindexReport> {
  const metas = input.vault.list()
  const present = new Set<string>(metas.map((m) => m.id))
  let embedded = 0
  let skipped = 0
  let removed = 0

  for (const meta of metas) {
    const body = parseNote(input.vault.read(meta.id)).body
    const hash = contentHash(body)
    if (!input.force && input.index.hashOf(meta.id) === hash) {
      skipped++
      continue
    }
    const [vector] = await input.embedder.embed([body])
    if (vector === undefined) continue
    input.index.upsert({ noteId: meta.id, title: meta.title, vector, contentHash: hash })
    embedded++
  }

  for (const record of input.index.records()) {
    if (!present.has(record.noteId)) {
      input.index.remove(record.noteId)
      removed++
    }
  }

  return { embedded, skipped, removed }
}
