import { describe, expect, it } from "vitest"
import { createDesktopBackend, loadSharedBackends } from "./desktop-backend"
import type { Invoke } from "./vault/tauri-vault"

/**
 * A minimal in-memory stand-in for the Rust vault + vector + state commands — enough to drive
 * createDesktopBackend without the native runtime. `failVectorFor` makes ONE workspace's index load
 * reject (a corrupt/locked shared DuckDB), so we can prove a bad shared include is dropped, not fatal.
 */
function fakeBackend(failVectorFor?: string): Invoke {
  const files = new Map<string, Map<string, string>>()
  const dir = (ws: string) => {
    let d = files.get(ws)
    if (d === undefined) {
      d = new Map()
      files.set(ws, d)
    }
    return d
  }
  return (async (cmd: string, args?: Record<string, unknown>) => {
    const a = (args ?? {}) as {
      workspace: string
      path?: string
      content?: string
      from?: string
      to?: string
    }
    const d = dir(a.workspace)
    switch (cmd) {
      case "vault_list_files":
        return [...d.keys()].filter((p) => !p.split("/").some((s) => s.startsWith(".")))
      case "vault_read_file": {
        const v = d.get(a.path as string)
        if (v === undefined) throw new Error(`ENOENT ${a.path}`)
        return v
      }
      case "vault_write_file":
        d.set(a.path as string, a.content as string)
        return undefined
      case "vault_rename_file": {
        const v = d.get(a.from as string)
        if (v !== undefined) {
          d.set(a.to as string, v)
          d.delete(a.from as string)
        }
        return undefined
      }
      case "vault_list_trash":
        return []
      case "vector_records":
        if (a.workspace === failVectorFor) throw new Error("corrupt/locked DuckDB")
        return []
      case "vector_upsert":
      case "vector_remove":
      case "vector_clear":
        return undefined
      case "state_load":
        return "{}"
      case "state_save":
        return undefined
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  }) as Invoke
}

describe("createDesktopBackend — the active project's backend (multi-project 2b)", () => {
  it("builds the active project's vault + index + storage, independent of any shared scope", async () => {
    const backend = await createDesktopBackend(
      "active",
      [{ title: "Home", body: "# Home\n" }],
      fakeBackend(),
    )
    expect(backend.vault.list().map((m) => m.title)).toContain("Home")
    await backend.flush()
  })
})

describe("loadSharedBackends — the active project's RAG scope (multi-project 2b)", () => {
  it("loads each included shared workspace", async () => {
    const scope = await loadSharedBackends(["shared-1", "shared-2"], fakeBackend())
    expect(scope.shared).toHaveLength(2)
    await scope.flush()
  })

  it("drops a bad include instead of failing the whole scope (fail-soft)", async () => {
    // shared-bad's vector index fails to open — an OPTIONAL include must never fail the whole load,
    // which App keeps separate from the active backend precisely so a bad include can't take the
    // active project down (and drop it to the in-webview fallback, hiding its real on-disk notes).
    const scope = await loadSharedBackends(["shared-bad", "shared-good"], fakeBackend("shared-bad"))
    expect(scope.shared).toHaveLength(1) // shared-good survived; shared-bad was dropped
    await scope.flush()
  })

  it("an empty scope loads nothing", async () => {
    const scope = await loadSharedBackends([], fakeBackend())
    expect(scope.shared).toHaveLength(0)
    await scope.flush()
  })
})
