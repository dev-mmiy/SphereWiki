import {
  type AiGraphLedger,
  type AiNoteLedger,
  aiKeptRate,
  share,
  type WorkspaceMetrics,
} from "@spherewiki/shared"
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
 *
 * Three AI signals coexist: `ai` is the **graph-wide** running-total kept-vs-reverted counter
 * (the session-persisted interim that over-counts cumulative additions); `ledger` is the **precise
 * per-note** M5 kept-vs-reverted contribution of the ACTIVE note — derived DB-free from its version
 * timeline, so per-dimension `kept/current` (and the AI share of the note's current links+tags) is
 * exact and self-corrects when a reverted edit is re-applied; and `graphLedger` is the same
 * precision **folded across every note** (`aiGraphLedger`) — the workspace-wide kept-vs-reverted
 * contribution, where a value AI introduced to 5 notes counts ONCE (deduped over the union of all
 * notes), not "5 times", so the headline "AI share of the wiki" matches the actual structure.
 */
export function MetricsPanel({
  metrics,
  ai,
  growth = null,
  ledger = null,
  graphLedger = null,
}: {
  metrics: WorkspaceMetrics
  ai: AiEditMetrics
  growth?: GraphGrowth | null
  ledger?: AiNoteLedger | null
  graphLedger?: AiGraphLedger | null
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

  // Precise per-note ledger (M5, DB-free): the share of the ACTIVE note's CURRENT links+tags that
  // a kept AI edit introduced. A 0/0 note shows no AI share (not "0%").
  const ledgerBlock =
    ledger !== null && ledger.aiEdits > 0
      ? (() => {
          const totalKept = ledger.links.kept + ledger.tags.kept
          const totalCurrent = ledger.links.current + ledger.tags.current
          const sharePct =
            totalCurrent > 0 ? `${Math.round(share(totalKept, totalCurrent) * 100)}%` : ""
          return (
            <p className="metrics-ai metrics-ledger">
              This note: {ledger.aiEdits} AI edit{ledger.aiEdits === 1 ? "" : "s"} · links{" "}
              <strong>
                {ledger.links.kept}/{ledger.links.current}
              </strong>{" "}
              kept · tags{" "}
              <strong>
                {ledger.tags.kept}/{ledger.tags.current}
              </strong>{" "}
              kept
              {sharePct && (
                <>
                  {" "}
                  · <strong>{sharePct}</strong> AI
                </>
              )}
            </p>
          )
        })()
      : null

  // Precise graph-wide rollup (M5, DB-free): the union of every note's kept AI links+tags vs the
  // union of the currently-present set — `aiGraphLedger`'s fold, so a value the AI introduced to
  // many notes counts ONCE. A 0-AI graph shows no rollup block (the `aiEdits > 0` guard).
  const graphBlock =
    graphLedger !== null && graphLedger.aiEdits > 0
      ? (() => {
          const totalKept = graphLedger.links.kept + graphLedger.tags.kept
          const totalCurrent = graphLedger.links.current + graphLedger.tags.current
          const sharePct =
            totalCurrent > 0 ? `${Math.round(share(totalKept, totalCurrent) * 100)}%` : ""
          return (
            <p className="metrics-ai metrics-ai-graph">
              Graph-wide: {graphLedger.aiEdits} AI edit
              {graphLedger.aiEdits === 1 ? "" : "s"} · links{" "}
              <strong>
                {graphLedger.links.kept}/{graphLedger.links.current}
              </strong>{" "}
              kept · tags{" "}
              <strong>
                {graphLedger.tags.kept}/{graphLedger.tags.current}
              </strong>{" "}
              kept
              {sharePct && (
                <>
                  {" "}
                  · <strong>{sharePct}</strong> AI
                </>
              )}
            </p>
          )
        })()
      : null

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
      {ledgerBlock}
      {graphBlock}
    </section>
  )
}
