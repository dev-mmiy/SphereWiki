import type { Answerer, CitedChunk, RagAnswer } from "./types"

/**
 * Deterministic, no-LLM answerer for M4a. It composes the answer ONLY from the
 * retrieved chunk text (verbatim, with inline `[n]` markers) and passes the cited
 * chunks through unchanged — it never invents content, so "the answer is
 * attributable to its citations" is directly assertable in tests. The real
 * Claude answerer (BYO key) replaces it behind `Answerer` at M4b.
 */

export interface ExtractiveAnswererOptions {
  /** Cap the number of chunks folded into the answer (default: all of them). */
  readonly maxChunks?: number
}

export function createExtractiveAnswerer(options: ExtractiveAnswererOptions = {}): Answerer {
  return {
    answer(_question, context): Promise<RagAnswer> {
      const limit = options.maxChunks ?? context.length
      const top: CitedChunk[] = context.slice(0, Math.max(0, limit))
      const answer = top.map((chunk, i) => `${chunk.text} [${(i + 1).toString()}]`).join("\n\n")
      return Promise.resolve({ answer, citations: top })
    },
  }
}
