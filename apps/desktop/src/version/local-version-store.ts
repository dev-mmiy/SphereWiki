import {
  type CrdtEngine,
  type CrdtSnapshot,
  createMemoryVersionStore,
  type EditOrigin,
  type Version,
  type VersionStore,
} from "@spherewiki/shared"
import { resolveStorage, type StorageLike } from "../vault/local-vault"

/**
 * A durable, localStorage-backed VersionStore: a note's commit history (revert/diff points)
 * survives a reload offline, so "every edit is versioned & revertible" holds across sessions —
 * not just within one. It wraps the engine-agnostic `createMemoryVersionStore` (the history logic
 * stays in `shared`): on open it loads the persisted versions, and on every commit it re-serializes
 * the list. Snapshots are opaque binary (`CrdtSnapshot`), base64-encoded for JSON storage. A
 * DB/GCS-backed store implements this same `VersionStore` seam on the server later.
 */
export interface LocalVersionStoreOptions {
  /** Storage key; scope per workspace + note so histories never co-mingle. */
  readonly key: string
  /** Storage backend; defaults to a working window.localStorage (injectable for tests). */
  readonly storage?: StorageLike
}

interface StoredVersion {
  id: string
  snapshot: string
  createdAt: number
  origin: EditOrigin
  label?: string
  parentId?: string
}

const CHUNK = 0x8000

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  // Chunk the conversion so a large snapshot can't blow the call stack via String.fromCharCode(...).
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function isOrigin(value: unknown): value is EditOrigin {
  if (typeof value !== "object" || value === null) return false
  const o = value as Record<string, unknown>
  return typeof o.actor === "string" && (o.kind === "human" || o.kind === "ai")
}

function deserialize(raw: unknown): Version | null {
  if (typeof raw !== "object" || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string" || typeof o.snapshot !== "string") return null
  if (typeof o.createdAt !== "number" || !isOrigin(o.origin)) return null
  let snapshot: CrdtSnapshot
  try {
    snapshot = fromBase64(o.snapshot)
  } catch {
    return null
  }
  return {
    id: o.id,
    snapshot,
    createdAt: o.createdAt,
    origin: o.origin,
    ...(typeof o.label === "string" ? { label: o.label } : {}),
    ...(typeof o.parentId === "string" ? { parentId: o.parentId } : {}),
  }
}

function serialize(versions: readonly Version[]): string {
  const stored: StoredVersion[] = versions.map((v) => ({
    id: v.id,
    snapshot: toBase64(v.snapshot),
    createdAt: v.createdAt,
    origin: v.origin,
    ...(v.label !== undefined ? { label: v.label } : {}),
    ...(v.parentId !== undefined ? { parentId: v.parentId } : {}),
  }))
  return JSON.stringify({ versions: stored })
}

export function createLocalStorageVersionStore(
  engine: CrdtEngine,
  options: LocalVersionStoreOptions,
): VersionStore {
  const storage = resolveStorage(options.storage)
  const { key } = options

  const load = (): Version[] => {
    const raw = storage.getItem(key)
    if (raw === null) return []
    try {
      const data = JSON.parse(raw) as { versions?: unknown }
      if (!Array.isArray(data.versions)) return []
      const out: Version[] = []
      for (const entry of data.versions) {
        const v = deserialize(entry)
        // A single malformed/foreign entry must never poison the whole history — drop it.
        if (v !== null) out.push(v)
      }
      return out
    } catch {
      return []
    }
  }

  return createMemoryVersionStore(engine, {
    initial: load(),
    onCommit: (versions) => {
      try {
        storage.setItem(key, serialize(versions))
      } catch {
        // Storage full/unavailable — keep the in-memory history rather than throw on a commit.
      }
    },
  })
}
