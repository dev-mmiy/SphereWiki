import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the workspace packages to source so the loop needs no build ordering.
      "@spherewiki/shared": path.resolve(import.meta.dirname, "../../packages/shared/src/index.ts"),
      "@spherewiki/ai": path.resolve(import.meta.dirname, "../../packages/ai/src/index.ts"),
    },
  },
})
