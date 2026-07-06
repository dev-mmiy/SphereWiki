import { parseNote, upsertFrontmatter } from "../frontmatter"
import { asNoteId, type NoteId } from "../types"
import type { NoteMeta, Vault } from "./types"

/**
 * The async filesystem operations the file-backed vault needs, injected so the core stays
 * platform-free (CLAUDE.md: `shared` runs identically everywhere). A `node:fs` adapter drives the
 * tests and the future `reindex` CLI; a Tauri-`invoke` adapter drives the desktop app (M2b.3).
 * Paths are "/"-joined (macOS/Linux at M2b); content is verbatim UTF-8 — no BOM / EOL / trailing
 * newline rewriting, or `parseNote`'s `\n` split, `contentHash`, and byte round-trip all break.
 */
export interface FsPort {
  /** Names (files + subdirs) directly under `dir`; resolves `[]` when `dir` does not exist. */
  readdir(dir: string): Promise<readonly string[]>
  /** The file's content as a verbatim UTF-8 string. */
  readFile(path: string): Promise<string>
  /** Write `content` verbatim; MUST be atomic (temp + rename) so a crash never truncates. */
  writeFile(path: string, content: string): Promise<void>
  /** Move/rename a file. */
  rename(from: string, to: string): Promise<void>
  /** Create `dir` (recursive); no-op if it already exists. */
  mkdir(dir: string): Promise<void>
}

export interface FileVaultOptions {
  readonly fs: FsPort
  /** The workspace's vault directory — one dir per workspace → isolation by construction. */
  readonly root: string
  /** Notes to write when the vault dir is genuinely empty (first run only). */
  readonly seed?: ReadonlyArray<{ title: string; body: string }>
  /** Id generator; inject for deterministic tests. Defaults to `crypto.randomUUID`. */
  readonly newId?: () => string
  /**
   * Called when a write-through to disk fails. The mirror already reflects the edit, so without
   * handling the on-disk `.md` lags the mirror — the app should retry / mark dirty / warn the user.
   * A rejected write no longer stalls later writes (each op is isolated), so a transient failure
   * (ENOSPC, a synced folder locking a file) can't silently discard the rest of the session.
   */
  readonly onWriteError?: (error: unknown) => void
}

export interface FileBackedVault {
  readonly vault: Vault
  /**
   * Resolves once the on-disk `.md` files have hydrated the in-memory mirror. Gate first render on
   * this (M2b.3) so `list()`/`read()` never serve a pre-hydration empty state.
   */
  readonly whenLoaded: Promise<void>
  /** Resolves once every queued write-through has settled (tests + clean shutdown). */
  flush(): Promise<void>
}

const MD = ".md"

/**
 * Byte budget for a filename stem — kept well under the common 255-byte path-component limit so a
 * long/multibyte (e.g. Japanese) title, plus a ` N` collision suffix and `.md`, still fits. Note
 * identity lives in frontmatter, so a truncated filename is harmless (the title is exact on disk).
 */
const MAX_STEM_BYTES = 200

/** Characters that are not portable in a filename (POSIX `/`, Windows-reserved set). */
const ILLEGAL_CHARS = '/\\:*?"<>|'

/** Join a dir and a name with "/" (POSIX; the app targets macOS/Linux at M2b). */
const join = (dir: string, name: string): string => `${dir}/${name}`

/**
 * Web Crypto `randomUUID`, present in browsers and Node 20+. Read off `globalThis` with a local
 * type so `shared` stays free of a DOM/Node lib assumption; callers that can't rely on it inject
 * `FileVaultOptions.newId` instead.
 */
function randomUuid(): string {
  const webcrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (webcrypto?.randomUUID) return webcrypto.randomUUID()
  throw new Error("crypto.randomUUID is unavailable — pass FileVaultOptions.newId")
}

/** UTF-8 byte width of a single code point (no `TextEncoder` dependency for `shared`). */
function codepointBytes(cp: number): number {
  if (cp < 0x80) return 1
  if (cp < 0x800) return 2
  if (cp < 0x10000) return 3
  return 4
}

/** Truncate to at most `maxBytes` UTF-8 bytes on a code-point boundary (never splits a character). */
function truncateToBytes(str: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const ch of str) {
    const size = codepointBytes(ch.codePointAt(0) ?? 0)
    if (bytes + size > maxBytes) break
    bytes += size
    end += ch.length // 2 for a surrogate pair, 1 otherwise
  }
  return str.slice(0, end)
}

/** Replace fs-illegal characters (the reserved set + ASCII control) with "-", keeping spaces. */
function replaceIllegal(str: string): string {
  let out = ""
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0
    out += cp < 0x20 || ILLEGAL_CHARS.includes(ch) ? "-" : ch
  }
  return out
}

/**
 * A filesystem-safe, human-friendly filename stem for a title (Obsidian-style — the title kept
 * verbatim, only fs-illegal characters replaced; spaces preserved). NFC-normalized so a
 * macOS-decomposed (NFD) title and its composed (NFC) form map to the same name, and byte-capped
 * so a very long title can't blow the fs name limit. Never a leading/trailing dot (a leading dot
 * would masquerade as a hidden metadata file) or space.
 */
export function vaultSlug(title: string): string {
  const cleaned = truncateToBytes(
    replaceIllegal(title.normalize("NFC")).replace(/ +/g, " "), // collapse space runs, keep spaces
    MAX_STEM_BYTES,
  ).replace(/^[.\s]+|[.\s]+$/g, "") // no leading/trailing dot or space (dotfiles / Windows)
  return cleaned === "" ? "untitled" : cleaned
}

/**
 * A file-backed Vault: raw Markdown `.md` files under a per-workspace directory are the source of
 * truth (the interim localStorage vault's on-disk successor, M2b.2). Implements Strategy A — the
 * `Vault` seam is synchronous but fs IO is async, so a full in-memory mirror is hydrated once at
 * `whenLoaded` and each mutation serves the mirror synchronously while a serialized write-through
 * persists to disk. Note identity (`id`, exact `title`) lives in YAML frontmatter, so the vault is
 * rebuildable from Markdown alone and an id survives a rename (the filename is a title slug that
 * changes; the frontmatter id does not). A file lacking an `id` is self-healed with a fresh one.
 *
 * Bounds (deferred to M2b.3 / M2b.7): a `rename` whose target slug names an *untracked* file that
 * appeared on disk after hydrate would overwrite it — reconciled by the external-`.md`-edit watcher
 * (M2b.7); and a bare frontmatter-less `write` would orphan the id on the next reload (the real
 * editor round-trips the frontmatter, so this doesn't occur in the app wiring).
 */
export function createFileBackedVault(options: FileVaultOptions): FileBackedVault {
  const { fs, root, seed = [] } = options
  const newId = options.newId ?? randomUuid
  const onWriteError = options.onWriteError ?? (() => {})

  interface Entry {
    meta: NoteMeta
    /** The full `.md` source (frontmatter + body) — exactly what `read` returns and `write` sets. */
    source: string
    /** The exact on-disk filename (as read from / written to the fs — may be NFD on macOS). */
    filename: string
  }
  const notes = new Map<NoteId, Entry>()
  /** Lowercased NFC filenames in use, for case-insensitive collision resolution (macOS APFS). */
  const usedNames = new Set<string>()
  const nameKey = (name: string): string => name.normalize("NFC").toLowerCase()

  const reserveUnique = (title: string): string => {
    const stem = vaultSlug(title)
    let name = `${stem}${MD}`
    let n = 1
    while (usedNames.has(nameKey(name))) {
      n += 1
      name = `${stem} ${n}${MD}`
    }
    usedNames.add(nameKey(name))
    return name
  }

  const mustGet = (id: NoteId): Entry => {
    const entry = notes.get(id)
    if (entry === undefined) throw new Error(`unknown note: ${id}`)
    return entry
  }

  /** Materialize a new note in the mirror (id/title into frontmatter). Caller persists the file. */
  const putNew = (id: NoteId, title: string, body: string): Entry => {
    const source = upsertFrontmatter(body, { id, title })
    const filename = reserveUnique(title)
    const entry: Entry = { meta: { id, title }, source, filename }
    notes.set(id, entry)
    return entry
  }

  // Serialize write-through IO after hydration so a mutation issued during startup lands after the
  // scan (never racing it) and concurrent writes can't interleave. Each op is ISOLATED with a catch
  // so one transient failure can't wedge the chain and silently drop every later edit.
  let tail: Promise<unknown>
  const enqueue = (op: () => Promise<void>): void => {
    tail = tail.then(() => op().catch(onWriteError))
  }
  const flush = (): Promise<void> => tail.then(() => undefined)

  const hydrate = async (): Promise<void> => {
    await fs.mkdir(root)
    const rawNames = (await fs.readdir(root))
      // Only top-level `.md`, skipping dot-files/dot-folders (`.trash/`, `.spherewiki/`) — a flat
      // scan never descends, so trashed/sidecar files can't enter the note set.
      .filter((n) => n.endsWith(MD) && !n.startsWith("."))
    // Deterministic order (readdir order is platform-dependent): sort by the NFC-normalized name.
    const sorted = [...rawNames].sort((a, b) => (a.normalize("NFC") < b.normalize("NFC") ? -1 : 1))

    const writebacks: Array<{ name: string; content: string }> = []
    for (const raw of sorted) {
      const key = nameKey(raw)
      const source = await fs.readFile(join(root, raw)) // read by the on-disk name (may be NFD)
      const fm = parseNote(source).frontmatter
      let id = typeof fm.id === "string" ? fm.id.trim() : ""
      let src = source
      if (id === "") {
        // Externally-created / legacy file with no id — self-heal so identity is stable hereafter.
        id = newId()
        src = upsertFrontmatter(source, { id })
        writebacks.push({ name: raw, content: src })
      } else if (notes.has(asNoteId(id))) {
        // Two files claim the same id — the first (sorted) wins, but reserve the loser's name so a
        // later create/rename can't reclaim it and clobber that still-on-disk file.
        usedNames.add(key)
        continue
      }
      // Dedup by note id, not by filename: two distinct files that only differ by case/normalization
      // are genuinely separate notes on a case-sensitive volume and both must load.
      const title =
        typeof fm.title === "string" && fm.title !== ""
          ? fm.title // exact title from frontmatter (file-wins, O1)
          : raw.normalize("NFC").slice(0, -MD.length) // else the filename stem (Obsidian-style)
      notes.set(asNoteId(id), { meta: { id: asNoteId(id), title }, source: src, filename: raw })
      usedNames.add(key)
    }
    for (const wb of writebacks) await fs.writeFile(join(root, wb.name), wb.content)

    if (notes.size === 0 && seed.length > 0) {
      for (const entry of seed) {
        const created = putNew(asNoteId(newId()), entry.title, entry.body)
        await fs.writeFile(join(root, created.filename), created.source)
      }
    }
  }

  tail = hydrate()
  const whenLoaded = tail.then(() => undefined)

  const vault: Vault = {
    list: () => [...notes.values()].map((e) => e.meta),
    read: (id) => mustGet(id).source,
    write: (id, body) => {
      const entry = mustGet(id)
      entry.source = body // verbatim — byte-exact persistence (id/title ride in the caller's body)
      enqueue(() => fs.writeFile(join(root, entry.filename), body))
    },
    create: (title, body = "") => {
      const entry = putNew(asNoteId(newId()), title, body)
      enqueue(() => fs.writeFile(join(root, entry.filename), entry.source))
      return entry.meta
    },
    ensure: (id, title, body = "") => {
      const existing = notes.get(id)
      if (existing !== undefined) return existing.meta // insert-if-absent: never overwrite a body
      const entry = putNew(id, title, body)
      enqueue(() => fs.writeFile(join(root, entry.filename), entry.source))
      return entry.meta
    },
    rename: (id, title) => {
      const entry = notes.get(id)
      if (entry === undefined) return // no-op on unknown id
      const oldName = entry.filename
      usedNames.delete(nameKey(oldName)) // free the old slug before re-deriving
      const source = upsertFrontmatter(entry.source, { title }) // title only; body untouched
      const filename = reserveUnique(title)
      notes.set(id, { meta: { id, title }, source, filename })
      enqueue(async () => {
        if (filename !== oldName) await fs.rename(join(root, oldName), join(root, filename))
        await fs.writeFile(join(root, filename), source)
      })
    },
  }

  return { vault, whenLoaded, flush }
}
