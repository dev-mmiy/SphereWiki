import { describe, expect, it } from "vitest"
import { parseNote } from "../frontmatter"
import { asNoteId } from "../types"
import type { Vault } from "./types"

/**
 * The `Vault` 6-method behavioral contract, run against every implementation (memory, localStorage,
 * file) so they can't drift. Assertions are made on the note **body** (`parseNote(read).body`) not
 * the raw source, because a file-backed vault carries note identity in frontmatter while the
 * in-memory vault does not — the shared contract is the semantics (identity, body content,
 * insert-if-absent, verbatim write), not the byte layout of the stored source.
 *
 * `makeVault` is async so a file-backed impl can `await whenLoaded` before returning.
 */
export function runVaultContract(
  name: string,
  makeVault: (seed?: ReadonlyArray<{ title: string; body: string }>) => Promise<Vault>,
): void {
  describe(`${name} — Vault contract`, () => {
    it("creates, lists, reads, and writes notes", async () => {
      const vault = await makeVault()
      const a = vault.create("Alpha", "# Alpha\n[[Beta]]")
      vault.create("Beta", "# Beta")

      expect(vault.list().map((m) => m.title)).toEqual(["Alpha", "Beta"])
      expect(parseNote(vault.read(a.id)).body).toContain("[[Beta]]")

      vault.write(a.id, "edited")
      expect(vault.read(a.id)).toBe("edited") // write persists verbatim
    })

    it("throws on an unknown note", async () => {
      const vault = await makeVault()
      expect(() => vault.read(asNoteId("nope"))).toThrow(/unknown note/)
    })

    it("renames a note's title in place, leaving the body untouched", async () => {
      const vault = await makeVault([{ title: "Alpha", body: "# Alpha\n" }])
      const [alpha] = vault.list()
      if (alpha === undefined) throw new Error("expected note")
      vault.rename(alpha.id, "Beta")
      expect(vault.list().map((m) => m.title)).toEqual(["Beta"])
      expect(parseNote(vault.read(alpha.id)).body).toBe("# Alpha\n")
    })

    it("rename is a no-op for an unknown id (does not throw or insert)", async () => {
      const vault = await makeVault([{ title: "Alpha", body: "a" }])
      expect(() => vault.rename(asNoteId("nope"), "X")).not.toThrow()
      expect(vault.list().map((m) => m.title)).toEqual(["Alpha"])
    })

    it("ensure inserts at an explicit id if absent, else returns the existing meta unchanged", async () => {
      const vault = await makeVault([{ title: "Home", body: "# Home\n" }])
      const [home] = vault.list()
      if (home === undefined) throw new Error("expected note")
      vault.write(home.id, "# Home\n\nlocal edit\n")

      const added = vault.ensure(asNoteId("remote-1"), "Remote", "# Remote\n")
      expect(added.id).toBe("remote-1")
      expect(parseNote(vault.read(asNoteId("remote-1"))).body).toBe("# Remote\n")

      const returned = vault.ensure(home.id, "Other", "# clobber\n")
      expect(returned.title).toBe("Home")
      expect(vault.read(home.id)).toBe("# Home\n\nlocal edit\n") // never overwritten
    })
  })
}
