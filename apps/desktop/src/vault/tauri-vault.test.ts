import { createFileBackedVault, parseNote } from "@spherewiki/shared"
import { describe, expect, it } from "vitest"
import { createTauriFsPort, type Invoke } from "./tauri-vault"

describe("createTauriFsPort", () => {
  it("forwards each op to the workspace-scoped Rust command with just the filename", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = []
    const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args])
      if (cmd === "vault_list_files") return ["Home.md"]
      if (cmd === "vault_read_file") return "# Home\n"
      return undefined
    }) as Invoke

    const fs = createTauriFsPort("ws-dev", invoke)
    expect(await fs.readdir("ws-dev")).toEqual(["Home.md"])
    expect(await fs.readFile("ws-dev/sub/Home.md")).toBe("# Home\n") // only the basename is sent
    await fs.writeFile("ws-dev/Note.md", "body")
    await fs.rename("ws-dev/Old.md", "ws-dev/New.md")
    await fs.mkdir("ws-dev") // no IPC — Rust create_dir_all's on write

    expect(calls).toEqual([
      ["vault_list_files", { workspace: "ws-dev" }],
      ["vault_read_file", { workspace: "ws-dev", name: "Home.md" }],
      ["vault_write_file", { workspace: "ws-dev", name: "Note.md", content: "body" }],
      ["vault_rename_file", { workspace: "ws-dev", from: "Old.md", to: "New.md" }],
    ])
  })
})

/**
 * A faithful in-memory stand-in for the Rust vault commands: one file store per workspace, scoped by
 * name — so the adapter + `createFileBackedVault` core can be exercised end-to-end without the
 * native runtime, proving the whole frontend -> invoke -> (fake) Rust -> disk path integrates.
 */
function fakeRustBackend(): { invoke: Invoke; files: Map<string, Map<string, string>> } {
  const files = new Map<string, Map<string, string>>()
  const dir = (ws: string) => {
    let d = files.get(ws)
    if (d === undefined) {
      d = new Map()
      files.set(ws, d)
    }
    return d
  }
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    const a = (args ?? {}) as {
      workspace: string
      name?: string
      content?: string
      from?: string
      to?: string
    }
    const d = dir(a.workspace)
    switch (cmd) {
      case "vault_list_files":
        return [...d.keys()]
      case "vault_read_file": {
        const value = d.get(a.name as string)
        if (value === undefined) throw new Error(`ENOENT: ${a.name}`)
        return value
      }
      case "vault_write_file":
        d.set(a.name as string, a.content as string)
        return undefined
      case "vault_rename_file": {
        const value = d.get(a.from as string)
        if (value === undefined) throw new Error(`ENOENT: ${a.from}`)
        d.set(a.to as string, value)
        d.delete(a.from as string)
        return undefined
      }
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  }) as Invoke
  return { invoke, files }
}

describe("Tauri file vault (adapter + core over a simulated Rust backend)", () => {
  const ids = (prefix: string): (() => string) => {
    let n = 0
    return () => `${prefix}-${(++n).toString()}`
  }

  it("writes notes as .md files and reloads them from the backend", async () => {
    const { invoke, files } = fakeRustBackend()
    const first = createFileBackedVault({
      fs: createTauriFsPort("ws-dev", invoke),
      root: "ws-dev",
      seed: [{ title: "Home", body: "# Home\n[[Ideas]]" }],
      newId: ids("a"),
    })
    await first.whenLoaded
    const ideas = first.vault.create("Ideas", "# Ideas\n")
    await first.flush()

    // The backend now holds real .md files with identity in frontmatter.
    const stored = files.get("ws-dev")
    expect([...(stored?.keys() ?? [])].sort()).toEqual(["Home.md", "Ideas.md"])
    expect(parseNote(stored?.get("Ideas.md") ?? "").frontmatter.id).toBe(ideas.id)

    // A fresh vault over the same backend = relaunching the native app.
    const second = createFileBackedVault({
      fs: createTauriFsPort("ws-dev", invoke),
      root: "ws-dev",
      newId: ids("b"),
    })
    await second.whenLoaded
    expect(
      second.vault
        .list()
        .map((m) => m.title)
        .sort(),
    ).toEqual(["Home", "Ideas"])
    expect(second.vault.read(ideas.id)).toContain("# Ideas") // the same id resolves after reload
  })

  it("surfaces a Rust write failure via onWriteError (not silently swallowed)", async () => {
    const invoke = (async (cmd: string) => {
      if (cmd === "vault_list_files") return []
      if (cmd === "vault_write_file") throw new Error("EIO (disk)")
      return undefined
    }) as Invoke
    const errors: unknown[] = []
    const { vault, flush } = createFileBackedVault({
      fs: createTauriFsPort("ws-dev", invoke),
      root: "ws-dev",
      onWriteError: (e) => errors.push(e),
    })
    await flush() // hydrate (empty dir)
    vault.create("Note", "# n\n") // its write-through will reject
    await flush()
    expect(errors).toHaveLength(1) // the failed disk write reached the handler
  })

  it("isolates workspaces — one vault never sees another's files", async () => {
    const { invoke, files } = fakeRustBackend()
    const a = createFileBackedVault({
      fs: createTauriFsPort("ws-a", invoke),
      root: "ws-a",
      seed: [{ title: "A note", body: "# A\n" }],
      newId: ids("a"),
    })
    await a.whenLoaded
    await a.flush()
    const b = createFileBackedVault({
      fs: createTauriFsPort("ws-b", invoke),
      root: "ws-b",
      newId: ids("b"),
    })
    await b.whenLoaded
    expect(b.vault.list()).toEqual([]) // ws-b's dir is empty; it can't read ws-a's note
    expect(files.get("ws-a")?.has("A note.md")).toBe(true)
  })
})
