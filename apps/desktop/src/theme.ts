/**
 * Theme selection (DESIGN.md Phase 1). Three choices: "system" (follow the OS via the CSS
 * `prefers-color-scheme` media query — the default), "light", or "dark" (force it via a
 * `data-theme` attribute on <html>). Pure and storage-injectable; no `matchMedia` needed (the CSS
 * resolves "system"), so it runs identically in the browser and in tests.
 */
export type Theme = "light" | "dark" | "system"

export const THEMES: readonly Theme[] = ["system", "light", "dark"]

const KEY = "spherewiki:theme"

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}

/** The stored theme, or "system" when unset/invalid/unavailable. */
export function readTheme(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): Theme {
  try {
    const raw = storage?.getItem(KEY)
    return isTheme(raw) ? raw : "system"
  } catch {
    return "system"
  }
}

/** Persist the theme choice (best-effort; storage failures are swallowed). */
export function storeTheme(
  theme: Theme,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(KEY, theme)
  } catch {
    // Storage full/unavailable — the in-memory selection still applies for this session.
  }
}

/** Apply the theme to the document: "system" clears the override; "light"/"dark" force it. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === "system") delete root.dataset.theme
  else root.dataset.theme = theme
}
