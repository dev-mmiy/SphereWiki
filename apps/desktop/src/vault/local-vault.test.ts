import { asNoteId } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { createLocalStorageVault } from "./local-vault"

const SEED = [
  { title: "Home", body: "# Home\n" },
  { title: "Ideas", body: "# Ideas\n" },
]

/** A working in-memory Storage stand-in (the test env's localStorage is unreliable). */
function memStorage(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v)
    },
  }
}

describe("createLocalStorageVault", () => {
  it("seeds on first use and lists the notes", () => {
    const vault = createLocalStorageVault(SEED, { key: "k", storage: memStorage() })
    expect(vault.list().map((m) => m.title)).toEqual(["Home", "Ideas"])
  })

  it("persists edits and restores them in a fresh instance (survives reload)", () => {
    const storage = memStorage()
    const vault = createLocalStorageVault(SEED, { key: "k", storage })
    const home = vault.list()[0]
    if (home === undefined) throw new Error("seed failed")
    vault.write(home.id, "# Home\n\nedited offline\n")

    const reloaded = createLocalStorageVault(SEED, { key: "k", storage })
    expect(reloaded.read(home.id)).toContain("edited offline")
    expect(reloaded.list().map((m) => m.title)).toEqual(["Home", "Ideas"])
  })

  it("does not re-seed when state already exists", () => {
    const storage = memStorage()
    createLocalStorageVault(SEED, { key: "k", storage }).create("Extra", "# Extra\n")
    const reloaded = createLocalStorageVault(SEED, { key: "k", storage })
    expect(reloaded.list().map((m) => m.title)).toEqual(["Home", "Ideas", "Extra"])
  })

  it("creates notes with ids that stay stable across reload", () => {
    const storage = memStorage()
    const extra = createLocalStorageVault(SEED, { key: "k", storage }).create("Extra", "x")
    const reloaded = createLocalStorageVault(SEED, { key: "k", storage })
    expect(reloaded.read(extra.id)).toBe("x")
  })

  it("isolates vaults by key on the same storage", () => {
    const storage = memStorage()
    createLocalStorageVault(SEED, { key: "a", storage }).create("OnlyA", "")
    const other = createLocalStorageVault(SEED, { key: "b", storage })
    expect(other.list().map((m) => m.title)).toEqual(["Home", "Ideas"])
  })

  it("mints distinct ids across separate vaults so peers can't collide", () => {
    const a = createLocalStorageVault(SEED, { key: "k", storage: memStorage() })
    const b = createLocalStorageVault(SEED, { key: "k", storage: memStorage() })
    const aHome = a.list()[0]
    const bHome = b.list()[0]
    expect(aHome?.id).toBeDefined()
    expect(aHome?.id).not.toBe(bHome?.id) // independent random UUIDs, not a shared "n1"
  })

  it("migrates legacy n* ids to fresh ids on load, preserving order and content", () => {
    const storage = memStorage()
    // Pre-S4b persisted shape: per-client counter ids that would collide across peers.
    storage.setItem(
      "k",
      JSON.stringify({
        counter: 2,
        notes: [
          { id: "n1", title: "Home", body: "# Home\n" },
          { id: "n2", title: "Ideas", body: "# Ideas\n" },
        ],
      }),
    )
    let i = 0
    const vault = createLocalStorageVault(SEED, {
      key: "k",
      storage,
      newId: () => `u${(++i).toString()}`,
    })
    expect(vault.list().map((m) => m.id)).toEqual(["u1", "u2"]) // re-keyed, order preserved
    const home = vault.list()[0]
    if (home === undefined) throw new Error("expected note")
    expect(vault.read(home.id)).toBe("# Home\n") // body preserved through migration

    // The migration is persisted: a reload sees UUIDs, never the legacy ids again.
    const reloaded = createLocalStorageVault(SEED, { key: "k", storage, newId: () => "unused" })
    expect(reloaded.list().map((m) => m.id)).toEqual(["u1", "u2"])
  })

  it("renames a title in place and persists it across reload", () => {
    const storage = memStorage()
    const vault = createLocalStorageVault(SEED, { key: "k", storage })
    const home = vault.list()[0]
    if (home === undefined) throw new Error("seed failed")
    vault.rename(home.id, "Index")
    expect(vault.list().map((m) => m.title)).toEqual(["Index", "Ideas"])

    const reloaded = createLocalStorageVault(SEED, { key: "k", storage })
    expect(reloaded.list().map((m) => m.title)).toEqual(["Index", "Ideas"]) // survived reload
    expect(reloaded.read(home.id)).toBe("# Home\n") // body untouched by the rename
  })

  it("ensure inserts a note at an explicit id if absent", () => {
    const vault = createLocalStorageVault(SEED, { key: "k", storage: memStorage() })
    const meta = vault.ensure(asNoteId("remote-1"), "Remote", "# Remote\n")
    expect(meta.id).toBe("remote-1")
    expect(vault.read(asNoteId("remote-1"))).toBe("# Remote\n")
    expect(vault.list().map((m) => m.title)).toContain("Remote")
  })

  it("ensure never overwrites an existing note's body", () => {
    const vault = createLocalStorageVault(SEED, { key: "k", storage: memStorage() })
    const home = vault.list()[0]
    if (home === undefined) throw new Error("expected note")
    vault.write(home.id, "# Home\n\nlocal edit\n")
    const returned = vault.ensure(home.id, "Different Title", "# clobber\n")
    expect(returned.title).toBe(home.title) // returns the existing meta, unchanged
    expect(vault.read(home.id)).toBe("# Home\n\nlocal edit\n") // body untouched
  })
})
