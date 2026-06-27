import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { CollapsiblePanel } from "./collapsible-panel"

afterEach(cleanup)

describe("CollapsiblePanel", () => {
  it("shows its title and renders children open by default", () => {
    render(
      <CollapsiblePanel title="Links">
        <p>panel body</p>
      </CollapsiblePanel>,
    )
    const summary = screen.getByText("Links")
    expect(summary.closest("details")?.open).toBe(true)
    expect(screen.getByText("panel body")).toBeTruthy()
  })

  it("starts collapsed when defaultOpen is false", () => {
    render(
      <CollapsiblePanel title="Tags" defaultOpen={false}>
        <p>body</p>
      </CollapsiblePanel>,
    )
    expect(screen.getByText("Tags").closest("details")?.open).toBe(false)
  })

  it("toggles open/closed when the summary is clicked", () => {
    render(
      <CollapsiblePanel title="Graph">
        <p>body</p>
      </CollapsiblePanel>,
    )
    const summary = screen.getByText("Graph")
    const details = summary.closest("details")
    expect(details?.open).toBe(true)
    fireEvent.click(summary)
    expect(details?.open).toBe(false)
    fireEvent.click(summary)
    expect(details?.open).toBe(true)
  })
})
