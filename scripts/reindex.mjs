#!/usr/bin/env node
// `pnpm reindex <vaultDir> [--check] [--force]` — rebuild a workspace's DuckDB vector store from its
// on-disk Markdown vault, the deterministic idempotent rebuild the "re-indexing is idempotent"
// invariant relies on (M2b.6). Reads ONLY Markdown (the single source of truth); the DuckDB index is
// derived and fully reconstructable from it. Runs in Node against the SAME .duckdb the Tauri Rust
// core writes (proven interoperable), via a node:fs vault adapter + a Node DuckDB VectorIndex.
//
// The @spherewiki/* packages are imported as BUILT dist (this script runs in raw Node, not
// vite/vitest), so `pnpm reindex` builds them first (see package.json), mirroring `dev:server`.

import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { createLocalEmbedder, createMemoryVectorIndex, reindexWorkspace } from "@spherewiki/ai"
import { asNoteId, asWorkspaceId, createFileBackedVault } from "@spherewiki/shared"

/** A `node:fs` FsPort driving the platform-free file-vault core (M2b.2) in Node. */
function nodeFsPort() {
  return {
    readdir: async (dir) => {
      try {
        return await readdir(dir)
      } catch (error) {
        if (error.code === "ENOENT") return []
        throw error
      }
    },
    readFile: (path) => readFile(path, "utf8"),
    // Atomic-ish: write a sibling temp (not `.md`, so the scan ignores it) then rename over the target.
    writeFile: async (path, content) => {
      const tmp = `${path}.tmp`
      await writeFile(tmp, content, "utf8")
      await rename(tmp, path)
    },
    rename: (from, to) => rename(from, to),
    mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
  }
}

/** SQL string escape (local, trusted Markdown content — parameterization avoided for a small CLI). */
const sql = (value) => `'${String(value).replace(/'/g, "''")}'`

/**
 * A Node DuckDB-backed VectorIndex over `<vaultDir>/.spherewiki/index.duckdb` — the same file + table
 * the Tauri Rust core uses. Strategy A: hydrate a memory index, reuse its search/records/hashOf, write
 * through to DuckDB. Returns the index plus flush()/close() (the file must be closed before reopening).
 */
async function openDuckDbIndex(dbPath, workspaceId, model) {
  await mkdir(dirname(dbPath), { recursive: true })
  const instance = await DuckDBInstance.create(dbPath)
  const conn = await instance.connect()
  await conn.run(
    "CREATE TABLE IF NOT EXISTS vectors(note_id TEXT PRIMARY KEY, title TEXT NOT NULL, vec TEXT NOT NULL, content_hash TEXT NOT NULL)",
  )

  const mem = createMemoryVectorIndex(workspaceId, model)
  const rows = (
    await conn.runAndReadAll(
      "SELECT note_id, title, vec, content_hash FROM vectors ORDER BY note_id",
    )
  ).getRows()
  for (const [noteId, title, vec, hash] of rows) {
    const vector = JSON.parse(vec)
    if (vector.length !== model.dimension) continue // stale dimension — skip; will re-embed
    mem.upsert({ noteId: asNoteId(noteId), title, vector, contentHash: hash })
  }

  let tail = Promise.resolve()
  const enqueue = (op) => {
    tail = tail.then(op)
  }
  const index = {
    workspaceId: mem.workspaceId,
    model: mem.model,
    search: (query, k) => mem.search(query, k),
    hashOf: (noteId) => mem.hashOf(noteId),
    records: () => mem.records(),
    upsert: (record) => {
      mem.upsert(record)
      const vec = JSON.stringify([...record.vector])
      enqueue(() =>
        conn.run(
          `INSERT OR REPLACE INTO vectors VALUES (${sql(record.noteId)}, ${sql(record.title)}, ${sql(vec)}, ${sql(record.contentHash)})`,
        ),
      )
    },
    remove: (noteId) => {
      mem.remove(noteId)
      enqueue(() => conn.run(`DELETE FROM vectors WHERE note_id = ${sql(noteId)}`))
    },
    clear: () => {
      mem.clear()
      enqueue(() => conn.run("DELETE FROM vectors"))
    },
  }
  return {
    index,
    flush: () => tail,
    close: () => {
      conn.closeSync()
      instance.closeSync()
    },
  }
}

/** Rebuild one vault's DuckDB vector store from its `.md` files. Returns the report + record count. */
async function reindexVault(vaultDir, { force = false } = {}) {
  const workspaceId = asWorkspaceId(basename(vaultDir))
  const embedder = createLocalEmbedder()
  const { vault, whenLoaded } = createFileBackedVault({ fs: nodeFsPort(), root: vaultDir })
  await whenLoaded
  const db = await openDuckDbIndex(
    join(vaultDir, ".spherewiki", "index.duckdb"),
    workspaceId,
    embedder.info,
  )
  try {
    const report = await reindexWorkspace({ vault, index: db.index, embedder, force })
    await db.flush()
    return { report, count: db.index.records().length }
  } finally {
    await db.flush()
    db.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes("--check")
  const force = args.includes("--force")
  const vaultDir = args.find((a) => !a.startsWith("--"))
  if (vaultDir === undefined) {
    console.error("usage: pnpm reindex <vaultDir> [--check] [--force]")
    process.exit(2)
  }
  // Reindex rebuilds an EXISTING vault's derived index; refuse a missing/typo'd path rather than
  // fabricating a spurious dir + .duckdb and reporting a green "records=0" success.
  const dir = await stat(vaultDir).catch(() => null)
  if (dir === null || !dir.isDirectory()) {
    console.error(`[reindex] vault directory not found: ${vaultDir}`)
    process.exit(2)
  }

  const first = await reindexVault(vaultDir, { force })
  console.log(
    `[reindex] ${vaultDir}: embedded=${first.report.embedded} skipped=${first.report.skipped} removed=${first.report.removed} (records=${first.count})`,
  )
  if (first.count === 0) console.warn("[reindex] warning: the vault has no notes (nothing indexed)")

  if (check) {
    // A 2nd run over the now-populated DuckDB must be a no-op — proving idempotency.
    const second = await reindexVault(vaultDir)
    const idempotent =
      second.report.embedded === 0 &&
      second.report.removed === 0 &&
      second.report.skipped === first.count &&
      second.count === first.count
    console.log(
      `[reindex --check] 2nd run: embedded=${second.report.embedded} skipped=${second.report.skipped} removed=${second.report.removed} records=${second.count} -> ${idempotent ? "IDEMPOTENT" : "NOT IDEMPOTENT"}`,
    )
    if (!idempotent) process.exit(1)
  }
}

main().catch((error) => {
  console.error("[reindex] failed:", error)
  process.exit(1)
})
