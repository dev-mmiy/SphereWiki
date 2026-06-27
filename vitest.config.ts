import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const sharedSrc = path.resolve(import.meta.dirname, "packages/shared/src/index.ts")
const aiSrc = path.resolve(import.meta.dirname, "packages/ai/src/index.ts")
// UI aliases to the src directory so the bare entry resolves to index (the CSS subpaths aren't
// imported from tests, but a directory alias keeps it consistent with the vite build config).
const uiSrc = path.resolve(import.meta.dirname, "packages/ui/src")
const alias = { "@spherewiki/shared": sharedSrc, "@spherewiki/ai": aiSrc, "@spherewiki/ui": uiSrc }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          // Explicit per-package so the React/jsdom packages (ui) don't get pulled into node env.
          include: [
            "packages/shared/src/**/*.test.ts",
            "packages/ai/src/**/*.test.ts",
            "apps/server/src/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "ui",
          include: ["packages/ui/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: [path.resolve(import.meta.dirname, "packages/ui/vitest.setup.ts")],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "desktop",
          include: ["apps/desktop/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: [path.resolve(import.meta.dirname, "apps/desktop/vitest.setup.ts")],
        },
      },
    ],
  },
})
