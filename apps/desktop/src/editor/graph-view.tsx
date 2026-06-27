import type { GraphEdge, GraphNode } from "@spherewiki/shared"

const SIZE = 240
const RADIUS = 96
const NODE_R = 7
const CENTER = SIZE / 2

/** Deterministic circular layout: node i sits at angle 2πi/N (starting at the top). */
function layout(nodes: readonly GraphNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const n = nodes.length
  nodes.forEach((node, i) => {
    if (n === 1) {
      pos.set(node.id, { x: CENTER, y: CENTER })
      return
    }
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    pos.set(node.id, {
      x: CENTER + RADIUS * Math.cos(angle),
      y: CENTER + RADIUS * Math.sin(angle),
    })
  })
  return pos
}

/**
 * The basic graph view: notes as nodes, `[[wikilink]]` relationships as edges, laid out on a
 * deterministic circle (no physics engine — cheap, stable, and unit-testable). A real node is a
 * button that navigates to its note; the active note is highlighted. A *dangling* node (a ghost:
 * a `[[link]]` whose note doesn't exist yet) is drawn dashed and, clicked, creates that note —
 * surfacing and growing the wiki's unwritten frontier. Node/edge colours are token-driven CSS, so
 * the graph follows the light/dark theme; only geometry (positions, radius) is set inline.
 */
export function GraphView({
  nodes,
  edges,
  activeId,
  canCreate,
  onNavigate,
  onCreate,
}: {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
  activeId: string
  canCreate: boolean
  onNavigate: (id: string) => void
  onCreate: (title: string) => void
}) {
  if (nodes.length === 0) {
    return (
      <section aria-label="Graph" className="graph">
        <p className="graph-empty">No notes to graph yet.</p>
      </section>
    )
  }

  const pos = layout(nodes)
  return (
    <section aria-label="Graph" className="graph">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="graph-svg">
        <title>Note graph</title>
        {edges.map((e) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (a === undefined || b === undefined) return null
          // Edges are presentational (no role/label), so assistive tech skips them already.
          return (
            <line
              key={`${e.from} ${e.to}`}
              className="graph-edge"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
            />
          )
        })}
        {nodes.map((node) => {
          const p = pos.get(node.id)
          if (p === undefined) return null
          const dangling = node.kind === "dangling"
          // A ghost is never the active note (its synthetic id is never selected); guard so a
          // stray ghost activeId can't mislabel the frontier node as current.
          const active = !dangling && node.id === activeId
          const disabled = dangling && !canCreate
          const activate = (): void => {
            if (disabled) return
            if (dangling) onCreate(node.title)
            else onNavigate(node.id)
          }
          const label = !dangling
            ? `Open ${node.title}`
            : disabled
              ? `Uncreated note: ${node.title}` // a viewer can't create it — don't promise an action
              : `Create note: ${node.title}`
          const className = dangling
            ? "graph-node graph-node-dangling"
            : active
              ? "graph-node graph-node-active"
              : "graph-node"
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG has no native button; role+handlers make the node accessible.
            <g
              key={node.id}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={label}
              aria-current={active ? "true" : undefined}
              aria-disabled={disabled || undefined}
              className={className}
              opacity={disabled ? 0.5 : undefined}
              onClick={activate}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault()
                  activate()
                }
              }}
            >
              {/* Colours come from the token-driven CSS (so the graph follows light/dark). */}
              <circle cx={p.x} cy={p.y} r={NODE_R} />
              <text x={p.x} y={p.y - NODE_R - 3} textAnchor="middle">
                {node.title}
              </text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}
