import type { RagAnswer } from "@spherewiki/ai"
import { useState } from "react"

/**
 * Ask-the-workspace panel: a question box that runs RAG retrieval + answering over
 * the active workspace and lists the cited notes (click to navigate). Read-only —
 * available to any member; it never mutates notes.
 */
export function AskPanel({
  onAsk,
  onNavigate,
  canAsk,
}: {
  onAsk: (query: string) => Promise<RagAnswer>
  onNavigate: (title: string) => void
  canAsk: boolean
}) {
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState<RagAnswer | null>(null)
  const [asking, setAsking] = useState(false)

  const ask = (): void => {
    if (!canAsk || query.trim() === "" || asking) return
    setAsking(true)
    onAsk(query)
      .then(setAnswer)
      .catch(() => setAnswer({ answer: "Ask failed", citations: [] }))
      .finally(() => setAsking(false))
  }

  return (
    <section className="ask-panel" aria-label="Ask">
      <input
        type="text"
        aria-label="Ask the workspace"
        value={query}
        disabled={!canAsk}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ask()
        }}
      />
      <button type="button" onClick={ask} disabled={!canAsk || asking || query.trim() === ""}>
        Ask
      </button>
      {answer && (
        <div className="ask-answer">
          <p>{answer.answer === "" ? "No relevant notes found." : answer.answer}</p>
          <ul>
            {answer.citations.map((c) => (
              <li key={c.noteId}>
                <button type="button" onClick={() => onNavigate(c.title)}>
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
