import { useCallback, useEffect, useState } from "react"
import { applyTheme, readTheme, storeTheme, type Theme } from "../theme"

const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" }
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" }

/** Theme state that applies to <html> on change and persists across sessions. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => readTheme())
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])
  return { theme, setTheme }
}

/** A compact control that cycles System → Light → Dark. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}.`}
      onClick={() => setTheme(NEXT[theme])}
    >
      {LABEL[theme]}
    </button>
  )
}
