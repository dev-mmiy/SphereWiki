import { expect, test } from "@playwright/test"

/**
 * The local-first, no-auth loop in a REAL browser: no sign-in, and every change must survive a
 * real page reload via the real local stores (localStorage vault + IndexedDB note registry). This
 * is the browser-level counterpart to the jsdom hook integration test.
 */
test("a body edit survives a real reload (localStorage vault)", async ({ page }) => {
  await page.goto("/")

  // The app shell loads with the seeded note list — no sign-in wall.
  await expect(page.getByRole("heading", { name: "SphereWiki", level: 1 })).toBeVisible()
  const nav = page.getByRole("navigation")
  await expect(nav.getByRole("button", { name: "Home", exact: true })).toBeVisible()

  // Edit the active note in the real CodeMirror editor.
  const editor = page.locator(".cm-content")
  await editor.click()
  await page.keyboard.type(" E2E-marker")
  await expect(editor).toContainText("E2E-marker")

  // Reload: the real localStorage vault must restore the edit (offline-first durability).
  await page.reload()
  await expect(page.locator(".cm-content")).toContainText("E2E-marker")
})

test("the trash survives a real reload, and a note restores (IndexedDB registry)", async ({
  page,
}) => {
  await page.goto("/")
  const nav = page.getByRole("navigation")
  await expect(nav.getByRole("button", { name: "Ideas", exact: true })).toBeVisible()

  // Soft-delete a note → it leaves the visible list.
  await nav.getByRole("button", { name: "Delete Ideas" }).click()
  await expect(nav.getByRole("button", { name: "Ideas", exact: true })).toHaveCount(0)

  // Reload: the tombstone lives in the registry CRDT, persisted to IndexedDB — it must stay deleted.
  await page.reload()
  const navAfter = page.getByRole("navigation")
  await expect(navAfter.getByRole("button", { name: "Ideas", exact: true })).toHaveCount(0)

  // The trash is a collapsed <details> — expand it, then restore (no human work silently destroyed).
  await navAfter.getByText(/^Trash \(/).click()
  await navAfter.getByRole("button", { name: "Restore Ideas" }).click()
  await expect(navAfter.getByRole("button", { name: "Ideas", exact: true })).toBeVisible()
})
