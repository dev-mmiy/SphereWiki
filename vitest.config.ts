import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const sharedSrc = path.resolve(import.meta.dirname, "packages/shared/src/index.ts")
const aiSrc = path.resolve(import.meta.dirname, "packages/ai/src/index.ts")
const alias = { "@spherewiki/shared": sharedSrc, "@spherewiki/ai": aiSrc }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts"],
          environment: "node",
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
