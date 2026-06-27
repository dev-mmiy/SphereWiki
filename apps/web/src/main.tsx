import { applyTheme, readTheme } from "@spherewiki/ui"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WebApp } from "./App"
import "@spherewiki/ui/tokens.css"
import "@spherewiki/ui/base.css"
import "./styles/web.css"

// Apply the stored theme before first paint so system/forced dark doesn't flash light — same path
// as the desktop entry, sharing the theme module from @spherewiki/ui.
applyTheme(readTheme())

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <StrictMode>
      <WebApp />
    </StrictMode>,
  )
}
