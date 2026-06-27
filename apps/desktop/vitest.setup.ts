import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount React trees between tests so renders don't leak across cases, and clear any persisted
// (localStorage) state — the durable vault and the AI-metrics recorder both key into it — so
// nothing leaks across cases if the test env's localStorage is functional.
afterEach(() => {
  cleanup()
  try {
    globalThis.localStorage?.clear()
  } catch {
    // The test env's localStorage may be unavailable/non-functional — nothing to clear.
  }
})
