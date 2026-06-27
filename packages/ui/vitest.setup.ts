import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount React trees between tests so renders don't leak across cases, and clear any persisted
// (localStorage) state so theme choices don't leak — mirrors the desktop app's setup, since the UI
// primitives carry the same DOM/theme side effects.
afterEach(() => {
  cleanup()
  try {
    globalThis.localStorage?.clear()
  } catch {
    // The test env's localStorage may be unavailable/non-functional — nothing to clear.
  }
  // Reset any theme override so a theme test can't leak <html data-theme> into the next case.
  delete document.documentElement.dataset.theme
})
