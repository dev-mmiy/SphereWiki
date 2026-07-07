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
  /**
   * All `.md` note paths, **root-relative and recursive** (e.g. `"Home.md"`, `"work/Foo.md"`),
   * excluding dot-files/dot-folders (`.trash/`, `.spherewiki/`). `[]` if the vault dir is absent.
   * Notes may live in subfolders for human-readable grouping — the adapter owns the vault root, so
   * every other method takes a **root-relative** path (never a full path or a bare basename).
   */
  listFiles(): Promise<readonly string[]>
  /** The file's content as a verbatim UTF-8 string (by root-relative path). */
  readFile(relpath: string): Promise<string>
  /** Write `content` verbatim, creating parent dirs; MUST be atomic (temp + rename). */
  writeFile(relpath: string, content: string): Promise<void>
  /** Move/rename a file (both root-relative; parent dirs of the target are created). */
  rename(fromRel: string, toRel: string): Promise<void>
  /**
   * Optional soft-delete-on-disk ops (O2). When an adapter provides them, the vault moves a
   * deleted note's file into a `.trash/` subdir (kept restorable, subpath preserved), and **loads
   * existing trashed files on hydrate** so the trash survives a reload — while a Markdown-only
   * `reindex` (an adapter WITHOUT these) never sees them, so it prunes the derived vector. Paths are
   * root-relative (for `trash`/`untrash`/`readTrash`) or relative to `.trash/` (for `listTrash`).
   */
  trash?(relpath: string): Promise<void>
  untrash?(relpath: string): Promise<void>
  listTrash?(): Promise<readonly string[]>
  readTrash?(relpath: string): Promise<string>
}

export interface FileVaultOptions {
  /** The filesystem seam — root-scoped by the adapter, so the vault deals only in relative paths. */
  readonly fs: FsPort
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

/** The directory portion of a "/"-joined root-relative path ("" for a top-level file). */
const dirOf = (relpath: string): string => {
  const i = relpath.lastIndexOf("/")
  return i === -1 ? "" : relpath.slice(0, i)
}

/** True for a note path we load: a `.md` file with no dot-prefixed path segment (defensive; the
 * adapter's `listFiles` already excludes dot-folders, but never trust it to). */
const isNotePath = (relpath: string): boolean =>
  relpath.endsWith(MD) && !relpath.split("/").some((seg) => seg.startsWith("."))

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
 * Sanitize a user-supplied folder into a safe "/"-joined relative dir (`""` = root): each segment is
 * run through `vaultSlug`, so fs-illegal chars, leading dots (no reaching `.trash/`/`.spherewiki/`),
 * and `.`/`..` traversal are all neutralized before it becomes a path. Empty/blank segments drop.
 */
export function normalizeFolder(folder: string): string {
  return folder
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .map(vaultSlug)
    .join("/")
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
  const { fs, seed = [] } = options
  const newId = options.newId ?? randomUuid
  const onWriteError = options.onWriteError ?? (() => {})

  interface Entry {
    meta: NoteMeta
    /** The full `.md` source (frontmatter + body) — exactly what `read` returns and `write` sets. */
    source: string
    /** The note's **root-relative** path (`"Home.md"` or `"work/Foo.md"`; may be NFD on macOS). */
    filename: string
    /** True while the note's file lives in `.trash/` (soft-deleted on disk, O2). Still in the mirror
     * (readable + in `list()`); the caller partitions live vs trash by its own tombstone. */
    trashed?: boolean
  }
  const notes = new Map<NoteId, Entry>()
  /** Lowercased NFC relative paths in use, for case-insensitive collision resolution (macOS APFS). */
  const usedNames = new Set<string>()
  const nameKey = (name: string): string => name.normalize("NFC").toLowerCase()
  /** The filename stem (basename minus `.md`, NFC) — the Obsidian-style title fallback for a file
   * with no frontmatter title, at any folder depth. */
  const stemOf = (relpath: string): string =>
    relpath
      .slice(relpath.lastIndexOf("/") + 1)
      .normalize("NFC")
      .slice(0, -MD.length)

  /** Reserve a unique root-relative `<dir>/<stem>.md`, suffixing ` N` on a case-insensitive clash so a
   * new file never overwrites one already in use. `dir` "" = vault root. */
  const reserveUniqueStem = (stem: string, dir: string): string => {
    const prefix = dir === "" ? "" : `${dir}/`
    let name = `${prefix}${stem}${MD}`
    let n = 1
    while (usedNames.has(nameKey(name))) {
      n += 1
      name = `${prefix}${stem} ${n}${MD}`
    }
    usedNames.add(nameKey(name))
    return name
  }

  /** Reserve a unique root-relative filename for `title` within directory `dir` ("" = vault root). */
  const reserveUnique = (title: string, dir = ""): string =>
    reserveUniqueStem(vaultSlug(title), dir)

  const mustGet = (id: NoteId): Entry => {
    const entry = notes.get(id)
    if (entry === undefined) throw new Error(`unknown note: ${id}`)
    return entry
  }

  /** The public metadata for a note: its folder (`path`, omitted at the root) plus its filename stem
   * (`name`) — the folder that would hold its children is `<path>/<name>/` (folder-note convention),
   * which is how the sidebar nests a child under its parent note. */
  const metaOf = (id: NoteId, title: string, filename: string): NoteMeta => {
    const dir = dirOf(filename)
    const name = stemOf(filename)
    return dir === "" ? { id, title, name } : { id, title, path: dir, name }
  }

  /** Materialize a new note in the mirror (id/title into frontmatter). Caller persists the file. */
  const putNew = (id: NoteId, title: string, body: string): Entry => {
    const source = upsertFrontmatter(body, { id, title })
    const filename = reserveUnique(title)
    const entry: Entry = { meta: metaOf(id, title, filename), source, filename }
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
    // All `.md` note paths, root-relative and RECURSIVE (subfolders are allowed for human-readable
    // grouping); dot-folders (`.trash/`, `.spherewiki/`) are excluded by the adapter + isNotePath.
    const rawNames = ((await fs.listFiles()) ?? []).filter(isNotePath)
    // Deterministic order (fs order is platform-dependent): sort by the NFC-normalized path.
    const sorted = [...rawNames].sort((a, b) => (a.normalize("NFC") < b.normalize("NFC") ? -1 : 1))

    const writebacks: Array<{ name: string; content: string }> = []
    for (const raw of sorted) {
      const key = nameKey(raw)
      const source = await fs.readFile(raw) // read by the root-relative path (may be NFD)
      const fm = parseNote(source).frontmatter
      let id = typeof fm.id === "string" ? fm.id.trim() : ""
      let src = source
      if (id === "") {
        // Externally-created / legacy file with no id — self-heal so identity is stable hereafter.
        id = newId()
        src = upsertFrontmatter(source, { id })
        writebacks.push({ name: raw, content: src })
      } else if (notes.has(asNoteId(id))) {
        // Two files claim the same id — the first (sorted) wins, but reserve the loser's path so a
        // later create/rename can't reclaim it and clobber that still-on-disk file.
        usedNames.add(key)
        continue
      }
      // Dedup by note id, not by path: two distinct files that only differ by case/normalization are
      // genuinely separate notes on a case-sensitive volume and both must load.
      const title =
        typeof fm.title === "string" && fm.title !== ""
          ? fm.title // exact title from frontmatter (file-wins, O1)
          : stemOf(raw) // else the filename stem (Obsidian-style; basename at any folder depth)
      notes.set(asNoteId(id), {
        meta: metaOf(asNoteId(id), title, raw),
        source: src,
        filename: raw,
      })
      usedNames.add(key)
    }
    for (const wb of writebacks) await fs.writeFile(wb.name, wb.content)

    // Load already-trashed notes (O2) so the trash survives a reload — only when the adapter exposes
    // trash reads (the Tauri app does; the `reindex` node adapter does NOT, so a rebuild-from-Markdown
    // never sees trashed files and prunes their derived vectors). Trashed entries are in the mirror
    // (readable, in `list()`) but flagged, so `trash`/`restore` know the file is under `.trash/`.
    // Loaded BEFORE the seed decision so an all-deleted vault (empty root, non-empty `.trash/`) is not
    // mistaken for a genuinely-empty first run and re-seeded (which would orphan its trashed notes).
    if (fs.listTrash !== undefined && fs.readTrash !== undefined) {
      const readTrash = fs.readTrash
      const trashNames = ((await fs.listTrash()) ?? [])
        .filter(isNotePath)
        .sort((a, b) => (a.normalize("NFC") < b.normalize("NFC") ? -1 : 1))
      for (const raw of trashNames) {
        const key = nameKey(raw)
        if (usedNames.has(key)) continue // a live file already owns this path
        const source = await readTrash(raw)
        const fm = parseNote(source).frontmatter
        const id = typeof fm.id === "string" ? fm.id.trim() : ""
        if (id === "" || notes.has(asNoteId(id))) continue // trashed files carry an id; skip dup/idless
        const title = typeof fm.title === "string" && fm.title !== "" ? fm.title : stemOf(raw)
        notes.set(asNoteId(id), {
          meta: metaOf(asNoteId(id), title, raw),
          source,
          filename: raw,
          trashed: true,
        })
        usedNames.add(key)
      }
    }

    // Seed only a genuinely-empty vault — empty of BOTH live AND trashed notes (see above).
    if (notes.size === 0 && seed.length > 0) {
      for (const entry of seed) {
        const created = putNew(asNoteId(newId()), entry.title, entry.body)
        await fs.writeFile(created.filename, created.source)
      }
    }
  }

  tail = hydrate()
  const whenLoaded = tail.then(() => undefined)

  /** The folder that holds a note's CHILDREN (folder-note convention): `<dir>/<stem>` for a note
   * whose file is `<dir>/<stem>.md`. A child of that note lives directly under this folder. */
  const childDirOf = (filename: string): string => {
    const dir = dirOf(filename)
    const stem = filename.slice(filename.lastIndexOf("/") + 1, -MD.length)
    return dir === "" ? stem : `${dir}/${stem}`
  }

  /** When a note is renamed/moved, carry its `<stem>/` subtree so children never orphan under the old
   * stem: every descendant note (filename under `oldChildDir/`) is relocated to `newChildDir/`. Each
   * destination is **collision-resolved** (`reserveUniqueStem`) so a descendant can never overwrite an
   * UNRELATED note already occupying the target path (which would silently destroy it). Processed
   * shallowest-first with an old→new directory map, so a suffixed folder-note keeps its own children. */
  const relocateChildren = (oldChildDir: string, newChildDir: string): void => {
    if (oldChildDir === newChildDir) return
    const prefix = `${oldChildDir}/`
    const descendants = [...notes.values()].filter(
      (c) => c.trashed !== true && c.filename.startsWith(prefix),
    )
    // Shallower paths first, so a folder-note is remapped before its own descendants consult the map.
    descendants.sort((a, b) => a.filename.split("/").length - b.filename.split("/").length)
    const dirMap = new Map<string, string>([[oldChildDir, newChildDir]])
    for (const child of descendants) {
      const fn = child.filename
      const oldDir = dirOf(fn)
      // The destination dir: the remapped (possibly-suffixed) parent if known, else the plain prefix
      // rewrite (for a folder-only intermediate dir, which can't itself collide as a file).
      const newDir = dirMap.get(oldDir) ?? `${newChildDir}${oldDir.slice(oldChildDir.length)}`
      usedNames.delete(nameKey(fn))
      const newFn = reserveUniqueStem(stemOf(fn), newDir)
      dirMap.set(childDirOf(fn), childDirOf(newFn)) // this note's own children follow its final name
      child.filename = newFn
      child.meta = metaOf(child.meta.id, child.meta.title, newFn)
      enqueue(() => fs.rename(fn, newFn)) // fn/newFn captured per iteration; parent dirs auto-created
    }
  }

  const vault: Vault = {
    list: () => [...notes.values()].map((e) => e.meta),
    read: (id) => mustGet(id).source,
    write: (id, body) => {
      const entry = mustGet(id)
      entry.source = body // verbatim — byte-exact persistence (id/title ride in the caller's body)
      // Capture the target path NOW: a `rename`/`move` issued after this edit (but before its
      // write-through runs) must NOT redirect this write to the note's new path — the write belongs
      // to the path the note had when it was edited, and the later rename/move then relocates it.
      const target = entry.filename
      if (entry.trashed === true && fs.untrash !== undefined) {
        // A write means the app is treating this note as LIVE (it never edits a trashed note — the
        // active-note guard excludes tombstoned ids). So `trashed` is STALE (a create-by-title
        // restore, or a failed/not-yet-flushed untrash): heal it — move the file back out of
        // `.trash/` and persist there, so the edit is never silently dropped (a data-safety fix).
        entry.trashed = false
        const untrash = fs.untrash
        enqueue(async () => {
          await untrash(target).catch(() => {}) // best-effort; the write below still persists
          await fs.writeFile(target, body)
        })
      } else {
        enqueue(() => fs.writeFile(target, body))
      }
    },
    create: (title, body = "") => {
      const entry = putNew(asNoteId(newId()), title, body)
      // Capture the path at enqueue time: create-in-folder issues a `move` in the SAME tick, so this
      // first write must land at the note's original path (the move's rename then relocates it) — not
      // chase `entry.filename` to the new folder and leave the rename with no source file.
      const target = entry.filename
      enqueue(() => fs.writeFile(target, entry.source))
      return entry.meta
    },
    ensure: (id, title, body = "") => {
      const existing = notes.get(id)
      if (existing !== undefined) return existing.meta // insert-if-absent: never overwrite a body
      const entry = putNew(id, title, body)
      const target = entry.filename
      enqueue(() => fs.writeFile(target, entry.source))
      return entry.meta
    },
    rename: (id, title) => {
      const entry = notes.get(id)
      if (entry === undefined) return // no-op on unknown id
      const oldName = entry.filename
      const oldChildDir = childDirOf(oldName) // capture the children folder before the stem changes
      usedNames.delete(nameKey(oldName)) // free the old slug before re-deriving
      const source = upsertFrontmatter(entry.source, { title }) // title only; body untouched
      // Keep the note in its own folder — only the basename (title slug) changes (folders are for
      // human grouping, so a rename never relocates a note across the hierarchy).
      const filename = reserveUnique(title, dirOf(oldName))
      notes.set(id, { meta: metaOf(id, title, filename), source, filename })
      relocateChildren(oldChildDir, childDirOf(filename)) // the note's children follow its new stem
      enqueue(async () => {
        if (filename !== oldName) await fs.rename(oldName, filename)
        await fs.writeFile(filename, source)
      })
    },
    // Soft-delete on disk (O2): move the note's file into `.trash/` (kept in the mirror + readable,
    // so the Trash UI + restore work; a Markdown-only `reindex` no longer lists it → prunes its
    // vector). No-op without the trash capability (e.g. the reindex adapter) or on an unknown/
    // already-trashed note.
    trash: (id) => {
      const entry = notes.get(id)
      if (entry === undefined || entry.trashed === true || fs.trash === undefined) return
      entry.trashed = true
      const move = fs.trash
      // Read the path at RUN time (not captured): nothing relocates a note before a same-tick trash
      // (`move` bails on a trashed note), and a run-time read stays correct even if a preceding failed
      // `move` reverted `entry.filename` back — so the file is always trashed from where it actually is.
      enqueue(() => move(entry.filename))
    },
    restore: (id) => {
      const entry = notes.get(id)
      if (entry === undefined || entry.trashed !== true || fs.untrash === undefined) return
      entry.trashed = false
      const move = fs.untrash
      // Capture: a `move` may follow a restore in the same tick (restore then relocate), and it must
      // untrash the note's ORIGINAL path, not chase the path the later move set.
      const target = entry.filename
      enqueue(() => move(target))
    },
    // Move a note into another folder (`""` = root), keeping id/title/body — purely organizational.
    // The `.md` relocates (basename re-derived from the title, collision-resolved in the target dir).
    // A single on-disk `rename` does the move: any edit that raced it lands correctly because `write`
    // captures its target path (above) and the queue is FIFO, so no stale duplicate is ever created.
    move: (id, folder) => {
      const entry = notes.get(id)
      if (entry === undefined || entry.trashed === true) return
      const oldName = entry.filename
      const targetDir = normalizeFolder(folder)
      if (targetDir === dirOf(oldName)) return // already in that folder
      const oldChildDir = childDirOf(oldName) // capture the children folder before the move
      // Refuse to move a note into its OWN subtree (its children folder or below) — that would make
      // the note a descendant of itself (and it'd match its own relocate prefix). No-op instead.
      if (targetDir === oldChildDir || targetDir.startsWith(`${oldChildDir}/`)) return
      usedNames.delete(nameKey(oldName)) // free the old path before re-deriving in the new dir
      const newName = reserveUnique(entry.meta.title, targetDir)
      entry.filename = newName // optimistic (Strategy A: the sidebar tree reflects the move at once)
      entry.meta = metaOf(id, entry.meta.title, newName)
      relocateChildren(oldChildDir, childDirOf(newName)) // the note's children move with it
      enqueue(async () => {
        try {
          await fs.rename(oldName, newName)
        } catch (error) {
          // The on-disk move failed (e.g. a synced folder briefly locked the file). Snap the mirror
          // back to the old path so later writes land THERE — never leaving a stale duplicate at the
          // old path that could win the reload dedup and silently revert the move (and later edits).
          // Guard on the mirror still pointing here, so a subsequent move isn't clobbered.
          if (entry.filename === newName) {
            usedNames.delete(nameKey(newName))
            usedNames.add(nameKey(oldName))
            entry.filename = oldName
            entry.meta = metaOf(id, entry.meta.title, oldName)
          }
          throw error // surfaced via the queue's onWriteError (not swallowed)
        }
      })
    },
  }

  return { vault, whenLoaded, flush }
}
