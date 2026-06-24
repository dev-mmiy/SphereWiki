import type { EmbeddingModelInfo, EmbeddingProvider, EmbeddingVector } from "./types"

/**
 * Deterministic, dependency-free embedder for M4a tests and offline dev: a hashed
 * bag-of-words projected into a fixed-dimension vector, L2-normalized. It is NOT a
 * semantic model — but it is pure (identical text -> identical vector) and texts
 * sharing tokens score higher than disjoint ones, so RAG ordering and the
 * "embeddings track content" / idempotency invariants are genuinely exercisable.
 * The real multilingual-e5-small (ONNX) replaces it behind EmbeddingProvider at M4b.
 */

export const LOCAL_EMBEDDING_DIM = 256

export interface LocalEmbedderOptions {
  /** Override the vector dimension (default LOCAL_EMBEDDING_DIM). */
  readonly dimension?: number
}

const WORD_RE = /[\p{L}\p{N}]+/gu

function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD_RE) ?? []
}

/** FNV-1a over a token's UTF-16 code units; unsigned. */
function hashToken(token: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    h = Math.imul(h ^ token.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

export function createLocalEmbedder(options: LocalEmbedderOptions = {}): EmbeddingProvider {
  const dimension = options.dimension ?? LOCAL_EMBEDDING_DIM
  const info: EmbeddingModelInfo = { model: "local-hashed-bow-v1", dimension }

  const embedOne = (text: string): number[] => {
    const vec = new Array<number>(dimension).fill(0)
    for (const token of tokenize(text)) {
      const bucket = hashToken(token) % dimension
      vec[bucket] = (vec[bucket] ?? 0) + 1
    }
    let sumSquares = 0
    for (const v of vec) sumSquares += v * v
    const norm = Math.sqrt(sumSquares)
    if (norm === 0) return vec // empty/symbol-only text -> zero vector, never NaN
    for (let i = 0; i < dimension; i++) vec[i] = (vec[i] ?? 0) / norm
    return vec
  }

  return {
    info,
    embed: (texts): Promise<EmbeddingVector[]> => Promise.resolve(texts.map(embedOne)),
  }
}
