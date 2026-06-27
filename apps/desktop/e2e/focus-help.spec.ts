import { expect, test } from "@playwright/test"

/**
 * Global keyboard shortcuts in a REAL browser: the focus-mode sidebar fold and the shortcut-help
 * overlay. These ride window-level keydown handlers, so they only truly hold up in a real DOM.
 */

test("ControlOrMeta+b folds the sidebar, and folds it back", async ({ page }) => {
  await page.goto("/")

  // The Search region lives in the sidebar — it's present in the default (unfolded) layout.
  const search = page.getByRole("region", { name: "Search" })
  await expect(search).toBeVisible()

  // Fold the sidebar: the Search region (and the rest of the sidebar) leaves the DOM.
  await page.keyboard.press("ControlOrMeta+b")
  await expect(search).toHaveCount(0)

  // Toggle again: focus mode is reversible — the sidebar (and Search) comes back.
  await page.keyboard.press("ControlOrMeta+b")
  await expect(page.getByRole("region", { name: "Search" })).toBeVisible()
})

test("? opens the keyboard-shortcuts overlay, and Escape closes it", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "SphereWiki", level: 1 })).toBeVisible()

  // With the body focused (no input clicked first), "?" raises the help overlay.
  await page.keyboard.press("Shift+Slash")
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" })
  await expect(dialog).toBeVisible()

  // Escape dismisses it — the overlay is fully reversible.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0)
})
