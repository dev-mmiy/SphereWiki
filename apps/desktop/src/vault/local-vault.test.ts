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
})
