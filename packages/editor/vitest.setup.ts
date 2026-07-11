import "fake-indexeddb/auto"
import { cleanup } from "@testing-library/react"
import { IDBFactory } from "fake-indexeddb"
import { afterEach } from "vitest"

// Mirror of the desktop setup: unmount React trees between tests, clear localStorage (the durable
// vault + AI-metrics recorder key into it), reset any theme override, and hand each test a fresh
// IndexedDB so persisted CRDT/registry state can't leak across cases.
afterEach(() => {
  cleanup()
  try {
    globalThis.localStorage?.clear()
  } catch {
    // The test env's localStorage may be unavailable/non-functional — nothing to clear.
  }
  delete document.documentElement.dataset.theme
  globalThis.indexedDB = new IDBFactory()
})
