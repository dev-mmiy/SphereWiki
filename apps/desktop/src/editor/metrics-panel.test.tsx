import type { WorkspaceMetrics } from "@spherewiki/shared"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MetricsPanel } from "./metrics-panel"

const metrics: WorkspaceMetrics = {
  notes: 3,
  links: 4,
  unwrittenLinks: 1,
  tags: 2,
  taggedNotes: 1,
}

describe("MetricsPanel", () => {
  it("renders each metric as a labelled value", () => {
    render(<MetricsPanel metrics={metrics} />)
    const region = screen.getByRole("region", { name: "Workspace metrics" })
    const value = (label: string): string | null | undefined =>
      within(region).getByText(label).closest(".metric")?.querySelector("dd")?.textContent
    expect(value("Notes")).toBe("3")
    expect(value("Links")).toBe("4")
    expect(value("Tags")).toBe("2")
    expect(value("Tagged")).toBe("1")
    expect(value("Unwritten")).toBe("1")
  })
})
