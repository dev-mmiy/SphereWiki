import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared UI package to source so the loop needs no build ordering. Aliasing to
      // the src *directory* lets both the bare entry (→ index) and the CSS subpaths
      // (`@spherewiki/ui/tokens.css`) resolve to source without a build step.
      "@spherewiki/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
})
