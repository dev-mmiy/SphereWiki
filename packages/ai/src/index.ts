/**
 * @spherewiki/ai — embeddings, RAG retrieval, and the on-save agent.
 *
 * M4a ships the seams + deterministic in-memory implementations (no credentials,
 * no model download): a content-addressed embedding provider, a per-workspace
 * vector index, a heuristic link/tag suggester, a scoped RAG retriever + answerer,
 * and the on-save agent that applies AI edits as a versioned, attributed,
 * revertible CRDT peer. The real Claude generation + multilingual-e5-small (ONNX)
 * + pgvector/DuckDB backends slot in behind these same interfaces at M4b.
 */

/** Default on-device embedding model (decision AD-2); the real provider lands at M4b. */
export const EMBEDDING_MODEL = "multilingual-e5-small" as const

export * from "./agent/on-save"
export * from "./agent/types"
export * from "./embedding/hash"
export * from "./embedding/local"
export * from "./embedding/types"
export * from "./index-store/memory"
export * from "./index-store/types"
export * from "./rag/extractive-answerer"
export * from "./rag/retriever"
export * from "./rag/types"
export * from "./reindex/reindex"
export * from "./suggest/apply"
export * from "./suggest/heuristic"
export * from "./suggest/types"
