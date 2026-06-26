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
 * The basic graph view: notes as nodes, `[[wikilink]]` relationships as edges, laid out on
 * a deterministic circle (no physics engine — cheap, stable, and unit-testable). Each node is
 * a button: clicking it navigates to that note. The active note is highlighted. Presentation
 * is via SVG attributes so it renders without depending on a stylesheet.
 */
export function GraphView({
  nodes,
  edges,
  activeId,
  onNavigate,
}: {
  nodes: readonly GraphNode[]
  edges: readonly GraphEdge[]
  activeId: string
  onNavigate: (id: string) => void
}) {
  if (nodes.length === 0) {
    return (
      <section aria-label="Graph" className="graph">
        <h3>Graph</h3>
        <p className="graph-empty">No notes to graph yet.</p>
      </section>
    )
  }

  const pos = layout(nodes)
  return (
    <section aria-label="Graph" className="graph">
      <h3>Graph</h3>
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
              stroke="#94a3b8"
              strokeWidth={1}
            />
          )
        })}
        {nodes.map((node) => {
          const p = pos.get(node.id)
          if (p === undefined) return null
          const active = node.id === activeId
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG has no native button; role+handlers make the node accessible.
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${node.title}`}
              aria-current={active ? "true" : undefined}
              className={active ? "graph-node graph-node-active" : "graph-node"}
              onClick={() => onNavigate(node.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault()
                  onNavigate(node.id)
                }
              }}
            >
              <circle cx={p.x} cy={p.y} r={NODE_R} fill={active ? "#2563eb" : "#cbd5e1"} />
              <text x={p.x} y={p.y - NODE_R - 3} textAnchor="middle" fontSize={9} fill="#334155">
                {node.title}
              </text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}
