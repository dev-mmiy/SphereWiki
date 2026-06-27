import { aiKeptRate, type WorkspaceMetrics } from "@spherewiki/shared"
import type { AiEditMetrics } from "../metrics/ai-metrics"

/**
 * A compact, point-in-time readout of the workspace's graph growth — the dogfooding signal that
 * the wiki is growing (notes / links), how much is referenced-but-unwritten (the frontier), and
 * how organized it is (tags) — plus the AI's **kept-vs-reverted** rate and contribution. The
 * graph counts are derived from Markdown; the AI counters accumulate across sessions.
 */
export function MetricsPanel({ metrics, ai }: { metrics: WorkspaceMetrics; ai: AiEditMetrics }) {
  const items: ReadonlyArray<readonly [string, number]> = [
    ["Notes", metrics.notes],
    ["Links", metrics.links],
    ["Tags", metrics.tags],
    ["Tagged", metrics.taggedNotes],
    ["Unwritten", metrics.unwrittenLinks],
  ]
  const keptRate = aiKeptRate(ai.applied, ai.reverted)
  const kept = keptRate === null ? "—" : `${Math.round(keptRate * 100)}%`

  return (
    <section aria-label="Workspace metrics" className="metrics">
      <h3>Workspace</h3>
      <dl>
        {items.map(([label, value]) => (
          <div key={label} className="metric">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="metrics-ai">
        AI: {ai.applied} applied · <strong>{kept} kept</strong> · {ai.reverted} undone · {ai.links}{" "}
        links, {ai.tags} tags added
      </p>
    </section>
  )
}
