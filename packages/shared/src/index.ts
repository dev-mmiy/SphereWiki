/**
 * @spherewiki/shared — platform-free core shared by desktop, server, and tests:
 * Markdown/frontmatter parsing, wikilink/backlink/graph logic, shared types,
 * the thin CRDT adapter (AD-4), and the engine-agnostic versioning layer (AD-5).
 */

export * from "./auth/memory"
export * from "./auth/permissions"
export * from "./auth/types"
export * from "./crdt/types"
export * from "./crdt/yjs"
export * from "./frontmatter"
export * from "./graph"
export * from "./metrics"
export * from "./search"
export * from "./sync/connect"
export * from "./sync/memory"
export * from "./sync/persistence"
export * from "./sync/types"
export * from "./tags"
export * from "./types"
export * from "./vault/memory"
export * from "./vault/types"
export * from "./version/diff"
export * from "./version/memory"
export * from "./version/types"
export * from "./wikilink"
