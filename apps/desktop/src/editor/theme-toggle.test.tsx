import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ThemeToggle } from "./theme-toggle"

// Cleanup + <html data-theme> reset happen in the shared vitest setup. (Persistence across a remount
// is covered by theme.test.ts, which uses an injected storage — the test env's localStorage is
// unreliable, so we don't depend on it here.)

describe("ThemeToggle", () => {
  it("starts at System and cycles System → Light → Dark → System, driving <html data-theme>", () => {
    render(<ThemeToggle />)
    const btn = () => screen.getByRole("button", { name: /^Theme:/ })
    expect(btn().textContent).toBe("System")
    expect(document.documentElement.dataset.theme).toBeUndefined() // system = no override

    fireEvent.click(btn())
    expect(screen.getByText("Light")).toBeTruthy()
    expect(document.documentElement.dataset.theme).toBe("light")

    fireEvent.click(btn())
    expect(document.documentElement.dataset.theme).toBe("dark")

    fireEvent.click(btn())
    expect(document.documentElement.dataset.theme).toBeUndefined() // back to system
  })
})
