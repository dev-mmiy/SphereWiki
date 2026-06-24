/**
 * Embedding seam (M4a). The on-device e5-small ONNX model implements this exact
 * interface at M4b — nothing above it changes. Embeddings are derived data: a
 * vector is always reproducible from the note's Markdown via an EmbeddingProvider.
 */

/** A dense embedding. Conventionally L2-normalized so cosine similarity == dot product. */
export type EmbeddingVector = readonly number[]

export interface EmbeddingModelInfo {
  /** Stable model identity; a change implies a forced full reindex (dimension may differ). */
  readonly model: string
  /** Vector length every embedding from this provider must have. */
  readonly dimension: number
}

export interface EmbeddingProvider {
  readonly info: EmbeddingModelInfo
  /** Embed a batch; the i-th result corresponds to the i-th input text. */
  embed(texts: readonly string[]): Promise<EmbeddingVector[]>
}
