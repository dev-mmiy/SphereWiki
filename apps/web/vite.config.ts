import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared packages to source so the loop needs no build ordering. Aliasing UI to
      // the src *directory* lets both the bare entry (→ index) and the CSS subpaths
      // (`@spherewiki/ui/tokens.css`) resolve to source without a build step. The editor (and the
      // shared/ai it pulls in) is now shared with desktop so the two clients can't drift.
      "@spherewiki/ui": path.resolve(import.meta.dirname, "../../packages/ui/src"),
      "@spherewiki/shared": path.resolve(import.meta.dirname, "../../packages/shared/src/index.ts"),
      "@spherewiki/ai": path.resolve(import.meta.dirname, "../../packages/ai/src/index.ts"),
      "@spherewiki/editor": path.resolve(import.meta.dirname, "../../packages/editor/src"),
    },
  },
})
