import type { Autonomy } from "@spherewiki/ai"
import { resolveStorage, type StorageLike } from "../vault/local-vault"

/**
 * Small, durable session UX preferences (not domain data): the last active note and the AI
 * autonomy mode, so a reload resumes where you left off instead of snapping back to the first note
 * and `auto`. localStorage-backed, scoped per workspace. Validated on read so a foreign/old blob
 * can never push a bad value into the UI.
 */
export interface SessionPrefs {
  /** Id of the note that was active last (validated against the vault by the caller). */
  readonly activeId?: string
  /** Last-chosen AI autonomy mode. */
  readonly aiAutonomy?: Autonomy
}

export interface SessionPrefsStore {
  read(): SessionPrefs
  /** Merge a patch into the stored prefs (preserving untouched fields) and persist. */
  write(patch: SessionPrefs): void
}

export interface SessionPrefsOptions {
  /** Storage key; scope per workspace so sessions never co-mingle. */
  readonly key: string
  /** Storage backend; defaults to a working window.localStorage (injectable for tests). */
  readonly storage?: StorageLike
}

const isAutonomy = (v: unknown): v is Autonomy => v === "off" || v === "suggest" || v === "auto"

export function createSessionPrefs(options: SessionPrefsOptions): SessionPrefsStore {
  const storage = resolveStorage(options.storage)
  const { key } = options

  const load = (): SessionPrefs => {
    const raw = storage.getItem(key)
    if (raw === null) return {}
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      const prefs: { activeId?: string; aiAutonomy?: Autonomy } = {}
      if (typeof data.activeId === "string") prefs.activeId = data.activeId
      if (isAutonomy(data.aiAutonomy)) prefs.aiAutonomy = data.aiAutonomy
      return prefs
    } catch {
      return {}
    }
  }

  let current: SessionPrefs = load()

  return {
    read: () => current,
    write: (patch) => {
      current = { ...current, ...patch }
      try {
        storage.setItem(key, JSON.stringify(current))
      } catch {
        // Storage full/unavailable — keep the in-memory prefs rather than throw on a UI write.
      }
    },
  }
}
