import type { ReactNode } from "react"

/**
 * A section the user can fold away to declutter a dense panel column. It's an uncontrolled native
 * `<details>`: the summary is the section heading, and toggling is the browser's job — we pass
 * `open` once for the initial state (a constant, so React never re-asserts it and the user's
 * collapse survives parent re-renders). The wrapped content keeps its own region/`aria-label`, so
 * collapsibility is purely additive over the existing accessible structure. Styling (the summary
 * heading, caret, spacing) is supplied by the host app's CSS via the stable class names below.
 */
export function CollapsiblePanel({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="rail-panel" open={defaultOpen}>
      <summary className="rail-panel-summary">{title}</summary>
      <div className="rail-panel-body">{children}</div>
    </details>
  )
}
