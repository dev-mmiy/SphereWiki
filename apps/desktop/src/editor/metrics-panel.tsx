import type { WorkspaceMetrics } from "@spherewiki/shared"

/**
 * A compact, point-in-time readout of the workspace's graph growth — the dogfooding signal that
 * the wiki is growing (notes / links), how much is referenced-but-unwritten (the frontier), and
 * how organized it is (tags). All values are derived from Markdown, so the panel just reflects
 * the current vault.
 */
export function MetricsPanel({ metrics }: { metrics: WorkspaceMetrics }) {
  const items: ReadonlyArray<readonly [string, number]> = [
    ["Notes", metrics.notes],
    ["Links", metrics.links],
    ["Tags", metrics.tags],
    ["Tagged", metrics.taggedNotes],
    ["Unwritten", metrics.unwrittenLinks],
  ]
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
    </section>
  )
}
