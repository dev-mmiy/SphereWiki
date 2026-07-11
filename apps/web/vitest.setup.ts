import "fake-indexeddb/auto"
import { cleanup } from "@testing-library/react"
import { IDBFactory } from "fake-indexeddb"
import { afterEach } from "vitest"

// The web client renders the shared NoteWorkspace, which persists its note registry to IndexedDB and
// caches the vault in localStorage — so, like the desktop/editor setup, unmount React trees, clear
// localStorage + the theme override, and hand each test a fresh IndexedDB so nothing leaks across.
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
