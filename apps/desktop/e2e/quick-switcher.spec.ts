import { expect, test } from "@playwright/test"

/**
 * The Cmd-K quick switcher in a REAL browser: open with a keyboard shortcut, jump to a note by
 * typing, and dismiss with Escape without navigating. Exercises the real dialog + editor binding.
 */

test("Cmd-K jumps to a note typed by name and shows its content", async ({ page }) => {
  await page.goto("/")
  const editor = page.locator(".cm-content")
  await expect(editor).toContainText("# Home")

  // Open the switcher, type a note name, and confirm with Enter.
  await page.keyboard.press("ControlOrMeta+k")
  const dialog = page.getByRole("dialog", { name: "Quick switcher" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("textbox", { name: "Jump to note" }).fill("Ideas")
  await page.keyboard.press("Enter")

  // The dialog closes and the editor now renders the selected note's body.
  await expect(dialog).toHaveCount(0)
  await expect(editor).toContainText("AI auto-links")
})

test("Escape dismisses the quick switcher without navigating", async ({ page }) => {
  await page.goto("/")
  const editor = page.locator(".cm-content")
  await expect(editor).toContainText("# Home")

  // Open then cancel — the dialog is gone and the active note is unchanged.
  await page.keyboard.press("ControlOrMeta+k")
  const dialog = page.getByRole("dialog", { name: "Quick switcher" })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")

  await expect(dialog).toHaveCount(0)
  await expect(editor).toContainText("# Home")
})
