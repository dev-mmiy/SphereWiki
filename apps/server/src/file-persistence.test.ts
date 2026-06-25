import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createFilePersistence } from "./file-persistence"

describe("createFilePersistence", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spherewiki-persist-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns null for an unknown room and round-trips saved state", () => {
    const p = createFilePersistence(dir)
    expect(p.load("room1")).toBeNull()
    p.save("room1", new Uint8Array([1, 2, 3]))
    expect([...(p.load("room1") ?? [])]).toEqual([1, 2, 3])
  })

  it("restores state across restarts (a new instance over the same dir)", () => {
    createFilePersistence(dir).save("room1", new Uint8Array([9, 8, 7]))
    const restarted = createFilePersistence(dir)
    expect([...(restarted.load("room1") ?? [])]).toEqual([9, 8, 7])
  })

  it("keeps rooms isolated", () => {
    const p = createFilePersistence(dir)
    p.save("alpha", new Uint8Array([1]))
    expect(p.load("alpha")).not.toBeNull()
    expect(p.load("beta")).toBeNull()
  })

  it("isolates rooms whose names contain path separators", () => {
    const p = createFilePersistence(dir)
    p.save("ws/note-1", new Uint8Array([1]))
    p.save("ws/note-2", new Uint8Array([2]))
    expect([...(p.load("ws/note-1") ?? [])]).toEqual([1])
    expect([...(p.load("ws/note-2") ?? [])]).toEqual([2])
  })

  it("handles very long room names (beyond the filesystem name limit)", () => {
    const p = createFilePersistence(dir)
    const room = `ws/${"x".repeat(500)}`
    p.save(room, new Uint8Array([42]))
    expect([...(p.load(room) ?? [])]).toEqual([42])
  })
})
