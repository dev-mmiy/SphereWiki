import { expect, test } from "@playwright/test"

/**
 * The real CM editing → derived links → create path: typing a [[wikilink]] to a missing note
 * surfaces a "create" affordance in the Links panel, and acting on it materializes a real note in
 * the registry-backed nav. This is the browser-level counterpart to the derived-link unit tests.
 */
test("creating a note from a dangling [[wikilink]] via the Links panel", async ({ page }) => {
  await page.goto("/")
  const nav = page.getByRole("navigation")
  const editor = page.locator(".cm-content")
  await expect(editor).toContainText("# Home")

  // No note named "Nowhere" exists yet.
  await expect(nav.getByRole("button", { name: "Nowhere", exact: true })).toHaveCount(0)

  // Type a wikilink to a missing note into the active note's body.
  await editor.click()
  await page.keyboard.type("[[Nowhere]]")
  await expect(editor).toContainText("[[Nowhere]]")

  // The derived Links panel offers to create the dangling target. Its accessible name is now
  // unambiguous — the graph node uses a distinct "Create note from graph: …" name — so this
  // strict-mode getByRole resolving to a single element also guards that disambiguation.
  const createButton = page.getByRole("button", { name: "Create note: Nowhere" })
  await expect(createButton).toBeVisible()
  await createButton.click()

  // The new note materializes in the registry-backed nav.
  await expect(nav.getByRole("button", { name: "Nowhere", exact: true })).toBeVisible()

  // Once the target exists, the link is no longer dangling — the create affordance is gone.
  await expect(createButton).toHaveCount(0)
})
