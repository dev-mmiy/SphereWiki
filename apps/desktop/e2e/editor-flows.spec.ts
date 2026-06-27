import { expect, test } from "@playwright/test"

/**
 * Richer real-browser flows that lean on CodeMirror *display* — exactly where the editor-opens-empty
 * bug hid from the jsdom tests (which only assert the Yjs text, never what CodeMirror renders).
 */

test("switching notes shows each note's content (no empty editor on open)", async ({ page }) => {
  await page.goto("/")
  const nav = page.getByRole("navigation")
  const editor = page.locator(".cm-content")
  await expect(editor).toContainText("# Home")

  // Each note must render its own body when selected — the regression guard for the empty-editor bug.
  await nav.getByRole("button", { name: "Getting Started", exact: true }).click()
  await expect(editor).toContainText("# Getting Started")

  await nav.getByRole("button", { name: "Ideas", exact: true }).click()
  await expect(editor).toContainText("AI auto-links")

  await nav.getByRole("button", { name: "Home", exact: true }).click()
  await expect(editor).toContainText("Welcome")
})

test("commit → edit → revert restores the text in the editor, and history survives a reload", async ({
  page,
}) => {
  await page.goto("/")
  const editor = page.locator(".cm-content")
  await expect(editor).toContainText("Welcome")

  // Commit a restore point of the seed, then edit past it.
  await page.getByRole("button", { name: "Commit version" }).click()
  await editor.click()
  await page.keyboard.type("EDITED")
  await expect(editor).toContainText("EDITED")

  // Revert: the edit is rolled back and the editor re-renders the committed text (binding intact).
  await page.getByRole("button", { name: "Revert" }).click()
  await expect(editor).toContainText("Welcome")
  await expect(editor).not.toContainText("EDITED")

  // The committed version persists across a reload, and the reverted body is what reopens.
  await page.reload()
  const editorAfter = page.locator(".cm-content")
  await expect(editorAfter).toContainText("Welcome")
  await expect(editorAfter).not.toContainText("EDITED")
  await expect(page.getByRole("button", { name: "Revert" })).toBeVisible()
})

test("AI organize adds tags that survive a reload", async ({ page }) => {
  await page.goto("/")
  const tags = page.getByRole("region", { name: "Tags" })
  await expect(tags.getByText(/no tags yet/i)).toBeVisible()

  // Run the on-save agent (heuristic, no credentials) — it auto-tags the note.
  await page.getByRole("button", { name: /organize with ai/i }).click()
  await expect(page.getByText(/AI added/)).toBeVisible()
  await expect(tags.getByRole("button", { name: /^#/ }).first()).toBeVisible()

  // The tags were written into the note's frontmatter (the vault), so they reload.
  await page.reload()
  const tagsAfter = page.getByRole("region", { name: "Tags" })
  await expect(tagsAfter.getByRole("button", { name: /^#/ }).first()).toBeVisible()
})
