import "fake-indexeddb/auto"
import { cleanup } from "@testing-library/react"
import { IDBFactory } from "fake-indexeddb"
import { afterEach } from "vitest"

// Unmount React trees between tests so renders don't leak across cases, and clear any persisted
// (localStorage) state — the durable vault and the AI-metrics recorder both key into it — so
// nothing leaks across cases if the test env's localStorage is functional. The note registry now
// persists locally via IndexedDB (so the trash survives a reload); fake-indexeddb provides it, and
// a fresh IDBFactory per test keeps persisted CRDT state from leaking across cases.
afterEach(() => {
  cleanup()
  try {
    globalThis.localStorage?.clear()
  } catch {
    // The test env's localStorage may be unavailable/non-functional — nothing to clear.
  }
  // Reset any theme override so a theme test can't leak <html data-theme> into the next case.
  delete document.documentElement.dataset.theme
  globalThis.indexedDB = new IDBFactory()
})
