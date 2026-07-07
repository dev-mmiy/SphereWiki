import { describe, expect, it } from "vitest"
import { parseNote } from "../frontmatter"
import { asNoteId } from "../types"
import { runVaultContract } from "./contract"
import { createFileBackedVault, type FsPort, vaultSlug } from "./file"

/**
 * An in-memory FsPort. The `store` is keyed by FULL path (`<root>/<relpath>`) so a real fs's byte
 * layout is mirrored exactly, but the FsPort methods take **root-relative** paths (the core's
 * contract), joining `root` internally — as the Tauri/node adapters do. `listFiles` returns every
 * `.md` under root, subfolders included, dot-segments (`.trash/`, `.spherewiki/`) excluded — the
 * recursive walk the real adapters implement. The same `store` outlives a vault, so re-opening over
 * it models a reload; `readFile` is exact-match, so NFC/NFD tests read the on-disk name as given.
 */
function fakeFs(
  store = new Map<string, string>(),
  root = "/w",
): FsPort & { store: Map<string, string> } {
  const abs = (rel: string) => `${root}/${rel}`
  return {
    store,
    listFiles: async () => {
      const prefix = `${root}/`
      return [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((p) => p.endsWith(".md") && !p.split("/").some((s) => s.startsWith(".")))
    },
    readFile: async (rel) => {
      const value = store.get(abs(rel))
      if (value === undefined) throw new Error(`ENOENT: ${rel}`)
      return value
    },
    writeFile: async (rel, content) => {
      store.set(abs(rel), content)
    },
    rename: async (from, to) => {
      const value = store.get(abs(from))
      if (value === undefined) throw new Error(`ENOENT: ${from}`)
      store.set(abs(to), value)
      store.delete(abs(from))
    },
  }
}

const ids = (prefix: string): (() => string) => {
  let n = 0
  return () => `${prefix}-${(++n).toString()}`
}

/** A trash-capable FsPort (models a `<root>/.trash/` area in the same store), as the Tauri adapter
 * provides — vs plain `fakeFs`, which (like the reindex node adapter) has no trash capability. Paths
 * are root-relative, so a trashed note preserves its subpath under `.trash/`. */
function trashFake(store = new Map<string, string>(), root = "/w"): FsPort {
  const trashAbs = (rel: string) => `${root}/.trash/${rel}`
  return {
    ...fakeFs(store, root),
    trash: async (rel) => {
      const value = store.get(`${root}/${rel}`)
      if (value === undefined) throw new Error(`ENOENT: ${rel}`)
      store.set(trashAbs(rel), value)
      store.delete(`${root}/${rel}`)
    },
    untrash: async (rel) => {
      const value = store.get(trashAbs(rel))
      if (value === undefined) throw new Error(`ENOENT trash: ${rel}`)
      store.set(`${root}/${rel}`, value)
      store.delete(trashAbs(rel))
    },
    listTrash: async () => {
      const prefix = `${root}/.trash/`
      return [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
    },
    readTrash: async (rel) => {
      const value = store.get(trashAbs(rel))
      if (value === undefined) throw new Error(`ENOENT trash: ${rel}`)
      return value
    },
  }
}

// The shared 6-method contract, proven against the file impl (memory + localStorage prove it too).
runVaultContract("file vault", async (seed) => {
  const { vault, whenLoaded } = createFileBackedVault({ fs: fakeFs(), seed })
  await whenLoaded
  return vault
})

describe("file-backed vault — on-disk specifics", () => {
  it("persists note bodies byte-for-byte and puts id + title in frontmatter", async () => {
    const fs = fakeFs()
    const body = "# 日本語\r\nno trailing newline and a --- rule" // CRLF, multibyte, no final \n
    const { vault, flush } = createFileBackedVault({ fs, newId: ids("id") })
    const meta = vault.create("メモ", body)
    await flush()

    const onDisk = fs.store.get("/w/メモ.md")
    if (onDisk === undefined) throw new Error("expected a file on disk")
    // Frontmatter carries identity; the body is preserved verbatim (CRLF + no trailing newline).
    const parsed = parseNote(onDisk)
    expect(parsed.frontmatter.id).toBe("id-1")
    expect(parsed.frontmatter.title).toBe("メモ")
    expect(parsed.body).toBe(body)
    expect(vault.read(meta.id)).toBe(onDisk) // read() returns the exact stored source
  })

  it("reloads the note list + bodies from disk with no server (a reload)", async () => {
    const fs = fakeFs()
    const first = createFileBackedVault({ fs, newId: ids("a") })
    const home = first.vault.create("Home", "# Home\n[[Ideas]]")
    first.vault.create("Ideas", "# Ideas\n")
    // Realistic edit: the editor round-trips the whole source (frontmatter incl.), so the id rides
    // along — write is verbatim, so a bare frontmatter-less body would orphan the id on reload.
    first.vault.write(home.id, `${first.vault.read(home.id)}\n\nedited`)
    await first.flush()

    // A fresh instance over the same store = reopening the app offline.
    const second = createFileBackedVault({ fs, newId: ids("b") })
    await second.whenLoaded
    expect(
      second.vault
        .list()
        .map((m) => m.title)
        .sort(),
    ).toEqual(["Home", "Ideas"])
    expect(second.vault.read(home.id)).toContain("edited") // the same id resolves after reload
  })

  it("keeps the id stable across a rename while repointing the filename", async () => {
    const fs = fakeFs()
    const { vault, flush } = createFileBackedVault({ fs, newId: ids("id") })
    const note = vault.create("Draft", "# Draft\n")
    await flush()
    vault.rename(note.id, "Final")
    await flush()

    expect(fs.store.has("/w/Draft.md")).toBe(false) // old file moved
    const renamed = fs.store.get("/w/Final.md")
    if (renamed === undefined) throw new Error("expected the renamed file")
    expect(parseNote(renamed).frontmatter.id).toBe("id-1") // id unchanged
    expect(parseNote(renamed).frontmatter.title).toBe("Final")
    expect(parseNote(renamed).body).toBe("# Draft\n") // body untouched by rename

    // The id still resolves, and a reload recovers the same id from the frontmatter.
    expect(vault.read(note.id)).toBe(renamed)
    const reopened = createFileBackedVault({ fs, newId: ids("z") })
    await reopened.whenLoaded
    expect(reopened.vault.read(note.id)).toContain("title: Final")
  })

  it("resolves same-title filename collisions (case-insensitively, APFS-style)", async () => {
    const fs = fakeFs()
    const { vault, flush } = createFileBackedVault({ fs, newId: ids("id") })
    vault.create("Note", "one")
    vault.create("note", "two") // differs only in case — APFS would collide
    vault.create("Note", "three")
    await flush()

    // Case is preserved in each filename ("note" stays "note"); collisions resolve case-insensitively.
    const names = [...fs.store.keys()].sort()
    expect(names).toEqual(["/w/Note 3.md", "/w/Note.md", "/w/note 2.md"])
  })

  it("NFC-normalizes a decomposed (NFD) filename on read", async () => {
    const nfd = "café.md" // "café.md" written decomposed, as macOS readdir returns it
    const store = new Map<string, string>([[`/w/${nfd}`, "# cafe\n"]])
    const { vault, whenLoaded } = createFileBackedVault({ fs: fakeFs(store) })
    await whenLoaded
    const [only] = vault.list()
    if (only === undefined) throw new Error("expected the note")
    expect(only.title).toBe("café") // composed NFC, not the decomposed on-disk form
    expect(only.title.normalize("NFC")).toBe(only.title)
  })

  it("self-heals a file with no id by minting and writing one back", async () => {
    const fs = fakeFs(new Map([["/w/Orphan.md", "# Orphan\n\nexternally created\n"]]))
    const first = createFileBackedVault({ fs, newId: ids("heal") })
    await first.whenLoaded
    await first.flush()

    const healed = fs.store.get("/w/Orphan.md")
    if (healed === undefined) throw new Error("expected the file")
    expect(parseNote(healed).frontmatter.id).toBe("heal-1") // id injected on disk
    expect(parseNote(healed).body).toBe("# Orphan\n\nexternally created\n") // body preserved

    // Reopening recovers the SAME id (stable), not a new one.
    const second = createFileBackedVault({ fs, newId: ids("other") })
    await second.whenLoaded
    const [note] = second.vault.list()
    expect(note?.id).toBe(asNoteId("heal-1"))
  })

  it("seeds only a genuinely empty vault dir (never over existing files)", async () => {
    const fs = fakeFs(new Map([["/w/Existing.md", "---\nid: keep-1\n---\n# Existing\n"]]))
    const { vault, whenLoaded } = createFileBackedVault({
      fs,
      seed: [{ title: "Seed", body: "# Seed\n" }],
    })
    await whenLoaded
    expect(vault.list().map((m) => m.title)).toEqual(["Existing"]) // seed suppressed
  })

  it("ignores dot-folders (trash / sidecar) during the scan", async () => {
    const fs = fakeFs(
      new Map([
        ["/w/Live.md", "---\nid: live-1\n---\n# Live\n"],
        ["/w/.trash/Deleted.md", "---\nid: del-1\n---\n# Deleted\n"],
        ["/w/.spherewiki/history.json", "{}"],
      ]),
    )
    const { vault, whenLoaded } = createFileBackedVault({ fs })
    await whenLoaded
    expect(vault.list().map((m) => m.title)).toEqual(["Live"])
    expect(() => vault.read(asNoteId("del-1"))).toThrow(/unknown note/) // trash not resurrected
  })

  it("soft-delete moves the .md into .trash/ (readable + in list), and restore moves it back", async () => {
    const store = new Map<string, string>()
    const first = createFileBackedVault({ fs: trashFake(store), newId: ids("id") })
    await first.whenLoaded
    const note = first.vault.create("Doomed", "# Doomed\n")
    await first.flush()
    expect(store.has("/w/Doomed.md")).toBe(true)

    first.vault.trash?.(note.id)
    await first.flush()
    expect(store.has("/w/Doomed.md")).toBe(false) // moved out of the vault root
    expect(store.has("/w/.trash/Doomed.md")).toBe(true) // into .trash/
    expect(first.vault.read(note.id)).toContain("# Doomed") // still readable in-session
    expect(first.vault.list().some((m) => m.id === note.id)).toBe(true) // still in list() (caller partitions)

    // Reload: the trashed note loads from .trash/ (survives the reload, still restorable).
    const second = createFileBackedVault({ fs: trashFake(store), newId: ids("z") })
    await second.whenLoaded
    expect(second.vault.read(note.id)).toContain("# Doomed")
    second.vault.restore?.(note.id)
    await second.flush()
    expect(store.has("/w/Doomed.md")).toBe(true) // back at the root
    expect(store.has("/w/.trash/Doomed.md")).toBe(false)
  })

  it("writing a note whose trashed flag is stale heals it (moves back out of .trash/, no lost edit)", async () => {
    // Reproduces the two-source-of-truth hazard: a note is displayed live (registry says so) but its
    // mirror entry is still `trashed` (a failed/not-yet-flushed untrash, or a create-by-title
    // restore). A write must NOT be silently dropped — it moves the file back and persists.
    const store = new Map<string, string>()
    const first = createFileBackedVault({ fs: trashFake(store), newId: ids("id") })
    await first.whenLoaded
    const note = first.vault.create("N", "# N\n")
    await first.flush()
    first.vault.trash?.(note.id)
    await first.flush()
    expect(store.has("/w/.trash/N.md")).toBe(true)

    // The note is treated as live again + edited (trashed flag still set on the entry).
    first.vault.write(note.id, `${first.vault.read(note.id)}\n\nrevived edit`)
    await first.flush()
    expect(store.has("/w/N.md")).toBe(true) // healed: moved back out of .trash/
    expect(store.has("/w/.trash/N.md")).toBe(false)
    expect(store.get("/w/N.md")).toContain("revived edit") // the edit persisted (not dropped)

    // Reload confirms the note is live with the edit, not stuck in trash.
    const second = createFileBackedVault({ fs: trashFake(store), newId: ids("z") })
    await second.whenLoaded
    expect(second.vault.read(note.id)).toContain("revived edit")
  })

  it("does NOT re-seed a vault whose notes were all deleted (trashed notes stay restorable)", async () => {
    const store = new Map<string, string>()
    const first = createFileBackedVault({
      fs: trashFake(store),
      seed: [{ title: "Home", body: "# Home\n" }],
      newId: ids("id"),
    })
    await first.whenLoaded // seeds Home
    const [home] = first.vault.list()
    if (home === undefined) throw new Error("expected the seed note")
    await first.flush()
    first.vault.trash?.(home.id) // delete the only note -> root empty, .trash/ has Home
    await first.flush()

    // Reload: the root is empty but `.trash/` is not — must NOT re-seed (which would shadow Home).
    const second = createFileBackedVault({
      fs: trashFake(store),
      seed: [{ title: "Home", body: "# Home\n" }],
      newId: ids("z"),
    })
    await second.whenLoaded
    expect(second.vault.list().map((m) => m.id)).toEqual([home.id]) // the trashed Home, not a fresh seed
    expect(second.vault.read(home.id)).toContain("# Home") // still restorable
  })

  it("a reindex-style vault (no trash capability) does NOT see trashed notes — so their vectors prune", async () => {
    const store = new Map<string, string>()
    const app = createFileBackedVault({ fs: trashFake(store), newId: ids("id") })
    await app.whenLoaded
    const live = app.vault.create("Live", "# Live\n")
    const gone = app.vault.create("Gone", "# Gone\n")
    await app.flush()
    app.vault.trash?.(gone.id)
    await app.flush()

    // The reindex adapter (plain fakeFs — no listTrash/readTrash) loads ONLY the vault root.
    const reindex = createFileBackedVault({ fs: fakeFs(store), newId: ids("r") })
    await reindex.whenLoaded
    const ids2 = reindex.vault.list().map((m) => m.id)
    expect(ids2).toContain(live.id)
    expect(ids2).not.toContain(gone.id) // trashed .md is under .trash/ → excluded → reindex prunes it
  })

  it("reads notes from subfolders (title fallback is the basename) and links are folder-transparent", async () => {
    const store = new Map<string, string>([
      ["/w/work/Meeting.md", "---\nid: m1\ntitle: Team Meeting\n---\n# Meeting\n[[Ideas]]\n"],
      ["/w/projects/deep/Untitled.md", "---\nid: u1\n---\n# no title in frontmatter\n"], // no title
      ["/w/Ideas.md", "---\nid: i1\ntitle: Ideas\n---\n# Ideas\n"],
    ])
    const v = createFileBackedVault({ fs: fakeFs(store), newId: ids("x") })
    await v.whenLoaded
    // Subfolder notes load; the title is the frontmatter title, else the BASENAME (not the path).
    expect(
      v.vault
        .list()
        .map((m) => m.title)
        .sort(),
    ).toEqual(["Ideas", "Team Meeting", "Untitled"])
    const meeting = v.vault.list().find((m) => m.title === "Team Meeting")
    if (meeting === undefined) throw new Error("expected the subfolder note")
    expect(v.vault.read(meeting.id)).toContain("[[Ideas]]") // its wikilink is intact regardless of folder
    // meta.path carries the note's folder (feeds the sidebar tree, v1b); root notes omit it.
    expect(meeting.path).toBe("work")
    expect(v.vault.list().find((m) => m.title === "Untitled")?.path).toBe("projects/deep")
    expect(v.vault.list().find((m) => m.title === "Ideas")?.path).toBeUndefined() // root note
  })

  it("keeps a renamed note in its own folder (only the basename slug changes)", async () => {
    const store = new Map<string, string>([
      ["/w/work/Meeting.md", "---\nid: m1\ntitle: Meeting\n---\n# Meeting\n"],
    ])
    const { vault, whenLoaded, flush } = createFileBackedVault({
      fs: fakeFs(store),
      newId: ids("x"),
    })
    await whenLoaded
    const [meeting] = vault.list()
    if (meeting === undefined) throw new Error("expected the note")
    vault.rename(meeting.id, "Standup")
    await flush()
    expect(store.has("/w/work/Meeting.md")).toBe(false) // old path gone
    expect(store.has("/w/work/Standup.md")).toBe(true) // renamed WITHIN work/, not moved to root
    expect(store.has("/w/Standup.md")).toBe(false)
    expect(parseNote(store.get("/w/work/Standup.md") ?? "").frontmatter.id).toBe("m1") // id stable
  })

  it("soft-deletes a subfolder note into .trash/ preserving its subpath, and restores it there", async () => {
    const store = new Map<string, string>([
      ["/w/work/Doomed.md", "---\nid: d1\ntitle: Doomed\n---\n# Doomed\n"],
    ])
    const first = createFileBackedVault({ fs: trashFake(store), newId: ids("x") })
    await first.whenLoaded
    const [note] = first.vault.list()
    if (note === undefined) throw new Error("expected the note")
    first.vault.trash?.(note.id)
    await first.flush()
    expect(store.has("/w/work/Doomed.md")).toBe(false)
    expect(store.has("/w/.trash/work/Doomed.md")).toBe(true) // subpath preserved under .trash/

    // Reload keeps it restorable; restore returns it to its ORIGINAL folder.
    const second = createFileBackedVault({ fs: trashFake(store), newId: ids("z") })
    await second.whenLoaded
    expect(second.vault.read(note.id)).toContain("# Doomed")
    second.vault.restore?.(note.id)
    await second.flush()
    expect(store.has("/w/work/Doomed.md")).toBe(true) // back in work/, not at root
    expect(store.has("/w/.trash/work/Doomed.md")).toBe(false)
  })

  it("vaultSlug keeps spaces, strips fs-illegal chars, and never yields an empty stem", () => {
    expect(vaultSlug("Getting Started")).toBe("Getting Started")
    expect(vaultSlug("a/b:c?")).toBe("a-b-c-")
    expect(vaultSlug("   ")).toBe("untitled")
    expect(vaultSlug(".hidden")).toBe("hidden")
  })

  // Regression guards for the adversarial-review findings.

  it("keeps persisting later edits after one write-through fails (no wedged queue)", async () => {
    // A fs that rejects exactly the first writeFile, then behaves. Models a transient ENOSPC / a
    // synced folder briefly locking a file — which must NOT silently drop the rest of the session.
    const store = new Map<string, string>()
    const base = fakeFs(store)
    let failNext = true
    const errors: unknown[] = []
    const fs: FsPort = {
      ...base,
      writeFile: async (path, content) => {
        if (failNext) {
          failNext = false
          throw new Error("ENOSPC (transient)")
        }
        await base.writeFile(path, content)
      },
    }
    const { vault, flush } = createFileBackedVault({
      fs,
      newId: ids("id"),
      onWriteError: (e) => errors.push(e),
    })
    vault.create("A", "# A\n") // this write fails once
    vault.create("B", "# B\n") // must still reach disk
    vault.create("C", "# C\n")
    await flush()

    expect(errors).toHaveLength(1) // the failure was surfaced, not swallowed
    expect(store.has("/w/B.md")).toBe(true) // later edits still persisted
    expect(store.has("/w/C.md")).toBe(true)
  })

  it("adds identity to a note whose body itself opens with a '---' block (no throw/loss)", async () => {
    const fs = fakeFs()
    // A leading `---…---` region that is NOT a YAML mapping (a plain-scalar paragraph) — `doc.set`
    // would throw on it; upsertFrontmatter must treat it as body and prepend a fresh block.
    const body = "---\njust a thematic-break paragraph, not frontmatter\n---\n# Body\n"
    const { vault, flush } = createFileBackedVault({ fs, newId: ids("id") })
    const meta = vault.create("Rule", body)
    await flush()

    const onDisk = fs.store.get("/w/Rule.md")
    if (onDisk === undefined) throw new Error("expected the file")
    const parsed = parseNote(onDisk)
    expect(parsed.frontmatter.id).toBe("id-1") // identity added
    expect(vault.read(meta.id)).toContain(body) // the original '---' region survived as body
  })

  it("caps the filename length for a very long / multibyte title", async () => {
    const fs = fakeFs()
    const longTitle = "あ".repeat(300) // 900 UTF-8 bytes — would blow the 255-byte fs limit
    const { vault, flush } = createFileBackedVault({ fs, newId: ids("id") })
    const meta = vault.create(longTitle, "# long\n")
    await flush()

    const [path] = [...fs.store.keys()]
    if (path === undefined) throw new Error("expected a file")
    const name = path.slice("/w/".length)
    const utf8Bytes = (s: string): number => {
      let n = 0
      for (const ch of s) {
        const cp = ch.codePointAt(0) ?? 0
        n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
      }
      return n
    }
    expect(utf8Bytes(name)).toBeLessThanOrEqual(255)
    expect(vault.read(meta.id)).toContain(longTitle) // the exact title is preserved in frontmatter
  })

  it("loads both of two case-variant files on a case-sensitive volume (dedup by id, not name)", async () => {
    const fs = fakeFs(
      new Map([
        ["/w/Note.md", "---\nid: upper\n---\n# Upper\n"],
        ["/w/note.md", "---\nid: lower\n---\n# lower\n"], // distinct id — a genuinely different note
      ]),
    )
    const { vault, whenLoaded } = createFileBackedVault({ fs })
    await whenLoaded
    expect(
      vault
        .list()
        .map((m) => m.id)
        .sort(),
    ).toEqual([asNoteId("lower"), asNoteId("upper")])
  })

  it("reports a whitespace-only title identically on create and after reload", async () => {
    const fs = fakeFs()
    const first = createFileBackedVault({ fs, newId: ids("id") })
    const meta = first.vault.create("   ", "# blank titled\n")
    expect(meta.title).toBe("   ")
    await first.flush()

    const second = createFileBackedVault({ fs, newId: ids("z") })
    await second.whenLoaded
    const [note] = second.vault.list()
    expect(note?.title).toBe("   ") // hydrate honors the present (non-empty) frontmatter title
  })
})
