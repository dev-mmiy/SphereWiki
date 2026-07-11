import type { DiffChunk, Version } from "@spherewiki/shared"

export function HistoryPanel({
  versions,
  onCommit,
  onRevert,
  onDiff,
  canEdit = true,
}: {
  versions: readonly Version[]
  onCommit: () => void
  onRevert: (id: string) => void
  onDiff: (id: string) => void
  canEdit?: boolean
}) {
  return (
    <aside className="history">
      <button type="button" onClick={onCommit} disabled={!canEdit}>
        Commit version
      </button>
      <ul>
        {versions.map((v) => (
          // data-kind drives the human-vs-AI attribution color (DESIGN.md visual language).
          <li key={v.id} className="version" data-kind={v.origin.kind}>
            <span className="version-main">
              <span className="version-label">{v.label ?? v.id}</span>
              <span className="version-origin">{v.origin.kind === "ai" ? "AI" : "you"}</span>
            </span>
            <span className="version-actions">
              <button type="button" onClick={() => onDiff(v.id)}>
                Diff
              </button>
              <button type="button" onClick={() => onRevert(v.id)} disabled={!canEdit}>
                Revert
              </button>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function DiffView({ chunks }: { chunks: readonly DiffChunk[] }) {
  // Stable per-chunk keys from running character offsets (no array-index keys).
  const items: { key: string; chunk: DiffChunk }[] = []
  let offset = 0
  for (const chunk of chunks) {
    items.push({ key: `${offset}:${chunk.op}`, chunk })
    offset += chunk.text.length
  }

  return (
    <pre className="diff">
      {items.map(({ key, chunk }) => (
        <span key={key} data-op={chunk.op}>
          {chunk.text}
        </span>
      ))}
    </pre>
  )
}
