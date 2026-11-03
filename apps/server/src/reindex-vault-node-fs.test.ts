/**
 * M2b.8 part 2 — Node-level fs-vault contract + reindex idempotency over a real `node:fs` directory.
 *
 * A `node:fs` `FsPort` (`nodeFsPort`, mirrored from `scripts/reindex.mjs`) drives a real OS temp
 * directory. `runVaultContract` runs the full 6-method `Vault` contract on this real fs-backed
 * vault; `reindexWorkspace` is run twice over unchanged disk Markdown with the SAME in-memory
 * `VectorIndex` to prove idempotency (mirrors `scripts/reindex.mjs --check`); then a note is moved
 * into `<dir>/.trash/` on disk and a fresh vault (rehydration that skips `.trash/`) proves O2:
 * `reindexWorkspace` prunes the trashed note by `removed=1`.
 *
 * `nodeFsPort` carries NO trash methods — a Markdown-only scan never sees `.trash/`, so any note a
 * caller moves there is invisible on the next hydration and its derived vector is pruned.
 */

import { mkdtempSync } from "node:fs"
import {
  rename as fsRename,
  writeFile as fsWrite,
  mkdir,
  readdir,
  readFile,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createLocalEmbedder, createMemoryVectorIndex, reindexWorkspace } from "@spherewiki/ai"
import {
  asWorkspaceId,
  createFileBackedVault,
  type FileBackedVault,
  type FileVaultOptions,
  type FsPort,
} from "@spherewiki/shared"
import { afterEach, describe, expect, it } from "vitest"
// `runVaultContract` is NOT on the shared barrel (packages/shared/src/index.ts omits ./vault/contract
// so the barrel doesn't pull `vitest` into the production build). A relative import is the zero-config
// alternative to adding it to the barrel.
import { runVaultContract } from "../../../packages/shared/src/vault/contract"

// ---------- helpers ----------

/** Every `createFileBackedVault` call registers its `flush` here so `afterEach` can drain every
 * in-flight write queue before the temp dirs are removed (avoids `ENOTEMPTY` races). */
const flushes: Array<() => Promise<void>> = []
/** Every temp dir handed out by `freshDir`, removed (recursively) in `afterEach`. */
let created: string[] = []

/** A fresh, empty OS temp directory; tracked for cleanup. */
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spherewiki-"))
  created.push(dir)
  return dir
}

/**
 * A `node:fs` `FsPort` root-scoped to `dir`, mirroring `scripts/reindex.mjs` (L23-59) without the
 * `@duckdb/node-api` coupling.
 *
 * - `listFiles` recursively walks subfolders, skipping dot-prefixed names (`.trash/`, `.spherewiki/`,
 *   and the transient `.tmp` siblings used by `writeFile`).
 * - `writeFile` writes a sibling `.tmp` then `rename`s atomically over the target — the scan ignores
 *   `.tmp` files, so a concurrent scan never sees a partial write.
 * - No `listTrash`/`readTrash` — a Markdown-only scan that never sees `.trash/` (O2).
 */
function nodeFsPort(dir: string): FsPort {
  const abs = (rel: string): string => join(dir, rel)

  async function walk(d: string, prefix: string): Promise<string[]> {
    let entries: { name: string; isDirectory: () => boolean }[]
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return []
      throw error
    }
    const out: string[] = []
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name
      if (ent.isDirectory()) out.push(...(await walk(join(d, ent.name), rel)))
      else if (ent.name.endsWith(".md")) out.push(rel)
    }
    return out
  }

  return {
    listFiles(): Promise<string[]> {
      return walk(dir, "")
    },
    readFile(rel: string): Promise<string> {
      return readFile(abs(rel), "utf8")
    },
    async writeFile(rel: string, content: string): Promise<void> {
      const full = abs(rel)
      await mkdir(dirname(full), { recursive: true })
      const tmp = `${full}.tmp`
      await fsWrite(tmp, content, "utf8")
      await fsRename(tmp, full)
    },
    async rename(from: string, to: string): Promise<void> {
      const dest = abs(to)
      await mkdir(dirname(dest), { recursive: true })
      await fsRename(abs(from), dest)
    },
  }
}

/** Create a file-backed vault, registering its `flush` for `afterEach` draining. */
function makeFileVault(options: FileVaultOptions): FileBackedVault {
  const vault = createFileBackedVault(options)
  flushes.push(vault.flush)
  return vault
}

/**
 * Fresh `createFileBackedVault` over a new OS temp dir, resolved after hydration. Each call yields a
 * fully independent vault (new `dir`, new `FsPort`, new in-memory mirror). `seed` notes are written
 * to disk inside `hydrate()`, so `whenLoaded` resolves with them present on disk.
 */
const makeVault = (
  seed?: ReadonlyArray<{ title: string; body: string }>,
): Promise<FileBackedVault["vault"]> => {
  const { vault, whenLoaded } = makeFileVault({ fs: nodeFsPort(freshDir()), seed: seed ?? [] })
  return whenLoaded.then(() => vault)
}

// ---------- 1. shared Vault contract over a real node:fs directory ----------

runVaultContract("node:fs file vault", makeVault)

// ---------- 2. reindex idempotency over unchanged disk Markdown ----------

const embedder = createLocalEmbedder()
const ws = asWorkspaceId("ws")

describe("node:fs reindex idempotency (mirrors pnpm reindex --check)", () => {
  it("second reindex over unchanged disk yields embedded=0 / skipped=N / removed=0 with stable records", async () => {
    const { vault, whenLoaded, flush } = makeFileVault({ fs: nodeFsPort(freshDir()) })
    await whenLoaded

    vault.create("Alpha", "# Alpha\nalpha beta gamma")
    vault.create("Beta", "# Beta\ndelta epsilon")
    await flush() // persist both to disk before the first index run

    const index = createMemoryVectorIndex(ws, embedder.info)

    const first = await reindexWorkspace({ vault, index, embedder })
    expect(first.embedded).toBe(2)
    expect(first.skipped).toBe(0)
    expect(first.removed).toBe(0)
    expect(index.records()).toHaveLength(2)

    // Snapshot stable state before the second pass.
    const recordsBefore = index.records()
    const hashesBefore = recordsBefore.map((r) => r.contentHash)

    const second = await reindexWorkspace({ vault, index, embedder })
    expect(second.embedded).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.removed).toBe(0)
    expect(index.records()).toEqual(recordsBefore)
    expect(index.records().map((r) => r.contentHash)).toEqual(hashesBefore)
  })
})

// ---------- 3. O2: a trashed note is pruned by a Markdown-only reindex ----------

describe("O2: reindex prunes a note moved into .trash/ via a no-trash FsPort", () => {
  it("prunes the trashed note's vector and leaves the live note untouched", async () => {
    const dir = freshDir()

    // --- setup: two notes on disk, index built from both ---
    const { vault, whenLoaded, flush } = makeFileVault({ fs: nodeFsPort(dir) })
    await whenLoaded

    vault.create("Live", "# Live\nalpha beta live note")
    vault.create("Gone", "# Gone\ngamma delta gone note")
    await flush()

    const index = createMemoryVectorIndex(ws, embedder.info)
    const built = await reindexWorkspace({ vault, index, embedder })
    expect(built.embedded).toBe(2)
    expect(index.records().some((r) => r.title === "Gone")).toBe(true)

    // --- act: move "Gone.md" into .trash/ on disk, then rehydrate from a fresh vault ---
    // nodeFsPort.listFiles() skips dot-prefixed names, so the fresh vault will not list
    // "Gone.md" — only "Live.md" survives hydration.
    await mkdir(join(dir, ".trash"), { recursive: true })
    await fsRename(join(dir, "Gone.md"), join(dir, ".trash", "Gone.md"))

    const second = makeFileVault({ fs: nodeFsPort(dir) })
    await second.whenLoaded

    const pruned = await reindexWorkspace({ vault: second.vault, index, embedder })

    // --- assert ---
    expect(pruned.removed).toBe(1)
    expect(index.records().some((r) => r.title === "Gone")).toBe(false)
    expect(index.records().some((r) => r.title === "Live")).toBe(true)
    expect(index.records()).toHaveLength(1)
  })
})

// ---------- cleanup ----------

afterEach(async () => {
  // Drain every in-flight write queue first, then remove the temp dirs.
  const drain = flushes.splice(0)
  await Promise.all(drain.map((f) => f()))
  const dirs = created
  created = []
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
})
