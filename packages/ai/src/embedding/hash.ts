/**
 * Canonical content hash of a note's embeddable text. The SINGLE producer of
 * `ContentHash` — centralizing it makes the "embeddings track content" invariant
 * a compile-time fact rather than a per-call-site convention: a vector can only
 * be stored alongside the hash of the exact text it was computed from.
 *
 * Non-cryptographic (two FNV-1a streams -> 16 hex chars). Suitable as a stale /
 * idempotency key; never use it for integrity or auth. Pure: no clock, randomness,
 * or platform APIs, so re-indexing the same Markdown is byte-identical.
 */

/** Branded so a raw string can never be passed where a real content hash is required. */
export type ContentHash = string & { readonly __brand: "ContentHash" }

export function contentHash(text: string): ContentHash {
  let h1 = 0x811c9dc5
  let h2 = 0xc2b2ae35
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
  return hex as ContentHash
}
