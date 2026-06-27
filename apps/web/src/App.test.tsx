import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WebApp } from "./App"

describe("WebApp (shared-UI shell)", () => {
  it("renders the brand and the not-connected empty state", () => {
    render(<WebApp />)
    expect(screen.getByRole("heading", { name: "SphereWiki", level: 1 })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Connect to a workspace" })).toBeTruthy()
  })

  it("exposes no ambient note access — it's a shell with no connected workspace (isolation-safe)", () => {
    render(<WebApp />)
    expect(screen.getByText("No workspace connected.")).toBeTruthy()
  })

  it("reuses the @spherewiki/ui ThemeToggle, which cycles the theme", () => {
    render(<WebApp />)
    // Default (cleared storage) is System; one click advances to Light — proves the shared theme
    // primitive works unchanged in a second app.
    const toggle = screen.getByRole("button", { name: /^Theme: System\./ })
    fireEvent.click(toggle)
    expect(screen.getByRole("button", { name: /^Theme: Light\./ })).toBeTruthy()
  })

  it("reuses the @spherewiki/ui CollapsiblePanel primitive", () => {
    render(<WebApp />)
    expect(screen.getByText("Workspaces")).toBeTruthy()
    expect(screen.getByText("About")).toBeTruthy()
  })
})
