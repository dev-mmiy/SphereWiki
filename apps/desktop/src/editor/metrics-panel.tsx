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
  // Colour the headline metric against the ≥~70%-kept success target.
  const keptState = keptRate === null ? undefined : keptRate >= 0.7 ? "good" : "low"

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
        AI: {ai.applied} applied ·{" "}
        <strong className="kept-rate" data-state={keptState}>
          {kept} kept
        </strong>{" "}
        · {ai.reverted} undone · {ai.links} links, {ai.tags} tags added
      </p>
    </section>
  )
}
