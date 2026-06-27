import { expect, test } from "@playwright/test"

/**
 * The `[[wikilink]]` title autocomplete driven by the REAL CodeMirror popup — the place where the
 * engine-agnostic `wikilinkSuggestions` ranking meets the live editor. Typing `[[Idea` must surface
 * the seeded "Ideas" note as a completion option, and accepting it must insert `[[Ideas]]`.
 */
test('typing "[[" suggests a note title and accepting it inserts a closed wikilink', async ({
  page,
}) => {
  await page.goto("/")
  const editor = page.locator(".cm-content")
  await expect(editor).toContainText("# Home")

  // Type an open wikilink with a prefix of a real note title — the completion source fires.
  await editor.click()
  await page.keyboard.type("[[Idea")

  // The real CodeMirror autocomplete tooltip appears with the matching "Ideas" option.
  const tooltip = page.locator(".cm-tooltip-autocomplete")
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator(".cm-completionLabel", { hasText: "Ideas" })).toBeVisible()

  // Accepting the completion inserts the title plus the closing `]]`.
  await page.keyboard.press("Enter")
  await expect(tooltip).toHaveCount(0)
  await expect(editor).toContainText("[[Ideas]]")
})
