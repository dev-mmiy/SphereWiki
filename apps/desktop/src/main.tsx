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
