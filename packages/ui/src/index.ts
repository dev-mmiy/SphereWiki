/**
 * `@spherewiki/ui` — the shared design-system foundation: design tokens + base layer (CSS, imported
 * by the app), the platform-agnostic theme module, and generic UI primitives. Imported by desktop
 * and (later) the web client so the look and the primitives never drift. SphereWiki-specific shell
 * and component styling stays in each app; this package holds only what both clients reuse verbatim.
 *
 * CSS is exposed via package `exports` (`@spherewiki/ui/tokens.css`, `@spherewiki/ui/base.css`) and
 * imported for its side effects by the app entry; the JS API is re-exported here.
 */
export { CollapsiblePanel } from "./primitives/collapsible-panel"
export { ThemeToggle, useTheme } from "./primitives/theme-toggle"
export type { Theme } from "./theme"
export { applyTheme, readTheme, storeTheme, THEMES } from "./theme"
