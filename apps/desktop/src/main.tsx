import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles/tokens.css"
import "./styles/base.css"
import { applyTheme, readTheme } from "./theme"

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
