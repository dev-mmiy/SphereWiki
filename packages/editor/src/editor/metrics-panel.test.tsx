import { aiGraphLedger, type WorkspaceMetrics } from "@spherewiki/shared"
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

  it("renders a graph-wide AI rollup (weighted, not averaged) when one is supplied", () => {
    // Two notes: 3 links+1 tag kept of 8+5 current, and 1 link kept of 2 → Σkept 4 of Σcurrent 13.
    const graph = aiGraphLedger([
      {
        ledger: {
          aiEdits: 3,
          links: { ever: 4, kept: 2, reverted: 2, current: 6 },
          tags: { ever: 3, kept: 1, reverted: 2, current: 5 },
        },
        linksCurrent: 6,
        tagsCurrent: 5,
      },
      {
        ledger: {
          aiEdits: 1,
          links: { ever: 1, kept: 1, reverted: 0, current: 2 },
          tags: { ever: 0, kept: 0, reverted: 0, current: 0 },
        },
        linksCurrent: 2,
        tagsCurrent: 0,
      },
    ])
    render(<MetricsPanel metrics={metrics} ai={ai} graphLedger={graph} />)
    const region = screen.getByRole("region", { name: "Workspace metrics" })
    expect(within(region).getByText(/Graph-wide: 4 AI edits/)).toBeTruthy()
    expect(within(region).getByText(/3\/8/)).toBeTruthy() // links kept / current (Σ)
    expect(within(region).getByText(/1\/5/)).toBeTruthy() // tags kept / current
    expect(within(region).getByText(/31%/)).toBeTruthy() // 4 of 13 = 31% weighted
  })

  it("omits the graph-wide rollup when the graph has no AI edits", () => {
    render(<MetricsPanel metrics={metrics} ai={ai} graphLedger={aiGraphLedger([])} />)
    expect(screen.queryByText(/Graph-wide/)).toBeNull()
  })
})
