import type { WorkspaceMetrics } from "@spherewiki/shared"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { AiEditMetrics } from "../metrics/ai-metrics"
import { MetricsPanel } from "./metrics-panel"

const metrics: WorkspaceMetrics = {
  notes: 3,
  links: 4,
  unwrittenLinks: 1,
  tags: 2,
  taggedNotes: 1,
}
const ai: AiEditMetrics = { applied: 10, reverted: 3, links: 12, tags: 8 }

describe("MetricsPanel", () => {
  it("renders each graph metric as a labelled value", () => {
    render(<MetricsPanel metrics={metrics} ai={ai} />)
    const region = screen.getByRole("region", { name: "Workspace metrics" })
    const value = (label: string): string | null | undefined =>
      within(region).getByText(label).closest(".metric")?.querySelector("dd")?.textContent
    expect(value("Notes")).toBe("3")
    expect(value("Links")).toBe("4")
    expect(value("Tags")).toBe("2")
    expect(value("Tagged")).toBe("1")
    expect(value("Unwritten")).toBe("1")
  })

  it("shows the AI kept-vs-reverted rate and contribution", () => {
    render(<MetricsPanel metrics={metrics} ai={ai} />)
    const region = screen.getByRole("region", { name: "Workspace metrics" })
    // 10 applied, 3 reverted → 70% kept.
    expect(within(region).getByText(/70% kept/)).toBeTruthy()
    expect(within(region).getByText(/10 applied/)).toBeTruthy()
    expect(within(region).getByText(/12 links, 8 tags added/)).toBeTruthy()
  })

  it("shows signed graph-growth deltas (and omits zero deltas) when a baseline is given", () => {
    render(<MetricsPanel metrics={metrics} ai={ai} growth={{ notes: 2, links: 0, tags: -1 }} />)
    const region = screen.getByRole("region", { name: "Workspace metrics" })
    const dd = (label: string): string | null | undefined =>
      within(region).getByText(label).closest(".metric")?.querySelector("dd")?.textContent
    expect(dd("Notes")).toContain("+2")
    expect(dd("Links")).toBe("4") // zero delta → no growth badge
    expect(dd("Tags")).toContain("-1")
  })

  it("shows a dash for the kept rate before any AI edit", () => {
    render(<MetricsPanel metrics={metrics} ai={{ applied: 0, reverted: 0, links: 0, tags: 0 }} />)
    expect(screen.getByText(/— kept/)).toBeTruthy()
  })
})
