import type { DiffChunk, Version } from "@spherewiki/shared"

export function HistoryPanel({
  versions,
  onCommit,
  onRevert,
  onDiff,
}: {
  versions: readonly Version[]
  onCommit: () => void
  onRevert: (id: string) => void
  onDiff: (id: string) => void
}) {
  return (
    <aside>
      <button type="button" onClick={onCommit}>
        Commit version
      </button>
      <ul>
        {versions.map((v) => (
          <li key={v.id}>
            {v.label ?? v.id} · {v.origin.kind}:{v.origin.actor}{" "}
            <button type="button" onClick={() => onDiff(v.id)}>
              Diff
            </button>{" "}
            <button type="button" onClick={() => onRevert(v.id)}>
              Revert
            </button>
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
