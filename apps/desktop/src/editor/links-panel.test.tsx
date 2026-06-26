import { asNoteId, type NoteMeta } from "@spherewiki/shared"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LinksPanel } from "./links-panel"
import type { OutgoingLink } from "./use-vault-workspace"

const meta = (id: string, title: string): NoteMeta => ({ id: asNoteId(id), title })

function renderPanel(
  outgoing: OutgoingLink[],
  opts: { canCreate?: boolean; backlinks?: NoteMeta[] } = {},
) {
  const onNavigate = vi.fn()
  const onCreate = vi.fn()
  render(
    <LinksPanel
      outgoing={outgoing}
      backlinks={opts.backlinks ?? []}
      canCreate={opts.canCreate ?? true}
      onNavigate={onNavigate}
      onCreate={onCreate}
    />,
  )
  return { onNavigate, onCreate }
}

describe("LinksPanel", () => {
  it("navigates when a resolved link is clicked", () => {
    const { onNavigate, onCreate } = renderPanel([{ title: "Ideas", exists: true }])
    fireEvent.click(screen.getByRole("button", { name: "Ideas" }))
    expect(onNavigate).toHaveBeenCalledWith("Ideas")
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("offers to create the note for a dangling link", () => {
    const { onCreate, onNavigate } = renderPanel([{ title: "Nowhere", exists: false }])
    const create = screen.getByRole("button", { name: "Create note: Nowhere" })
    fireEvent.click(create)
    expect(onCreate).toHaveBeenCalledWith("Nowhere")
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it("disables creating a dangling link's note without write permission", () => {
    const { onCreate } = renderPanel([{ title: "Nowhere", exists: false }], { canCreate: false })
    const create = screen.getByRole("button", { name: "Create note: Nowhere" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.click(create)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("navigates from a backlink", () => {
    const { onNavigate } = renderPanel([], { backlinks: [meta("a", "Home")] })
    fireEvent.click(screen.getByRole("button", { name: "Home" }))
    expect(onNavigate).toHaveBeenCalledWith("Home")
  })
})
