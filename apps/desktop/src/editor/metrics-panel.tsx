import { aiKeptRate, type WorkspaceMetrics } from "@spherewiki/shared"
import type { AiEditMetrics } from "../metrics/ai-metrics"
import type { GraphGrowth } from "../metrics/graph-growth"

type Row = { label: string; value: number; delta?: number }

/**
 * A compact, point-in-time readout of the workspace's graph growth — the dogfooding signal that
 * the wiki is growing (notes / links), how much is referenced-but-unwritten (the frontier), and
 * how organized it is (tags) — plus the AI's **kept-vs-reverted** rate and contribution. The
 * graph counts are derived from Markdown; the AI counters accumulate across sessions. When a
 * `growth` baseline is supplied, the notes / links / tags rows also show the signed change since
 * the workspace was first opened, making "the graph is growing" visible at a glance.
 */
export function MetricsPanel({
  metrics,
  ai,
  growth = null,
}: {
  metrics: WorkspaceMetrics
  ai: AiEditMetrics
  growth?: GraphGrowth | null
}) {
  const rows: readonly Row[] = [
    { label: "Notes", value: metrics.notes, delta: growth?.notes },
    { label: "Links", value: metrics.links, delta: growth?.links },
    { label: "Tags", value: metrics.tags, delta: growth?.tags },
    { label: "Tagged", value: metrics.taggedNotes },
    { label: "Unwritten", value: metrics.unwrittenLinks },
  ]
  const keptRate = aiKeptRate(ai.applied, ai.reverted)
  const kept = keptRate === null ? "—" : `${Math.round(keptRate * 100)}%`
  // Colour the headline metric against the ≥~70%-kept success target.
  const keptState = keptRate === null ? undefined : keptRate >= 0.7 ? "good" : "low"

  return (
    <section aria-label="Workspace metrics" className="metrics">
      <dl>
        {rows.map((r) => (
          <div key={r.label} className="metric">
            <dt>{r.label}</dt>
            <dd>
              {r.value}
              {r.delta !== undefined && r.delta !== 0 && (
                <span
                  className="metric-growth"
                  data-dir={r.delta > 0 ? "up" : "down"}
                  title="since first opened"
                >
                  {r.delta > 0 ? `+${r.delta}` : r.delta}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="metrics-ai">
        AI: {ai.applied} applied ·{" "}
        <strong className="kept-rate" data-state={keptState}>
          {kept} kept
        </strong>{" "}
        · {ai.reverted} undone · {ai.links} links, {ai.tags} tags added
      </p>
    </section>
  )
}
