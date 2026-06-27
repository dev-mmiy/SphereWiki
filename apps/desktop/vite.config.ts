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
      // UI aliases to the src *directory* so both the bare entry (→ index) and the CSS subpaths
      // (`@spherewiki/ui/tokens.css`) resolve to source without a build step.
      "@spherewiki/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
})
