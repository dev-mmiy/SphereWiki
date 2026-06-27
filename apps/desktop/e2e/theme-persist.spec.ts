import { expect, test } from "@playwright/test"

/**
 * Theme is a UI preference stored in real localStorage and applied to <html data-theme> before
 * first paint. The cycle is System -> Light -> Dark; this asserts a concrete choice survives a real
 * reload, the browser-level proof of pre-paint theme persistence.
 */
test("the theme toggle persists a concrete choice across a real reload (localStorage)", async ({
  page,
}) => {
  await page.goto("/")

  // Fresh context starts on "System" — no data-theme attribute is forced.
  const toggle = page.getByRole("button", { name: /^Theme:/ })
  await expect(toggle).toHaveAccessibleName(/^Theme: System/)
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark")

  // Cycle System -> Light -> Dark to reach a concrete theme that pins <html data-theme>.
  await toggle.click()
  await expect(toggle).toHaveAccessibleName(/^Theme: Light/)
  await toggle.click()
  await expect(toggle).toHaveAccessibleName(/^Theme: Dark/)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")

  // Reload: the theme is read from real localStorage and applied before first paint.
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.getByRole("button", { name: /^Theme:/ })).toHaveAccessibleName(/^Theme: Dark/)
})
