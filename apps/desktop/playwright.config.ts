import { defineConfig, devices } from "@playwright/test"

/**
 * Real-browser E2E for the desktop web build. These run a real Chromium against the Vite dev
 * server, so they exercise what jsdom can't: real CodeMirror editing, real localStorage (the
 * vault) and real IndexedDB (the note registry) across a real page reload. Kept OUT of the unit
 * gates — specs live in `e2e/` (`*.spec.ts`, outside `src/`, so Vitest never picks them up) and run
 * via `pnpm test:e2e`. The dev server is reused if one is already up, else started for the run.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
