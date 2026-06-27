import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount React trees between tests and clear any persisted theme choice (localStorage) so the
// ThemeToggle's initial state can't leak across cases, mirroring the desktop setup.
afterEach(() => {
  cleanup()
  try {
    globalThis.localStorage?.clear()
  } catch {
    // The test env's localStorage may be unavailable/non-functional — nothing to clear.
  }
  delete document.documentElement.dataset.theme
})
