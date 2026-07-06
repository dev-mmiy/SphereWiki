import { applyTheme, readTheme } from "@spherewiki/ui"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "@spherewiki/ui/tokens.css"
import "@spherewiki/ui/base.css"
import "./styles/workspace.css"
import "./styles/components.css"

// Apply the stored theme before first paint so system/forced dark doesn't flash light.
applyTheme(readTheme())

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// Tauri IPC smoke: under the native shell only (never in the browser build or tests), prove the
// frontend <-> Rust bridge works. Dynamic-imported behind the runtime guard so the web bundle never
// loads @tauri-apps/api. This is the seam the vault / DuckDB commands (M2b.3+) will use.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke<string>("ping")
      .then((reply) => console.info("[tauri] ping ->", reply))
      .catch((error) => console.error("[tauri] ping failed", error)),
  )
}
