import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { WelcomePanel } from "./welcome-panel"

function setup(props: Partial<Parameters<typeof WelcomePanel>[0]> = {}) {
  const onCreate = vi.fn()
  const onShowShortcuts = vi.fn()
  render(
    <WelcomePanel
      canCreate={true}
      onCreate={onCreate}
      onShowShortcuts={onShowShortcuts}
      deletedCount={0}
      {...props}
    />,
  )
  return { onCreate, onShowShortcuts }
}

describe("WelcomePanel", () => {
  it("introduces SphereWiki and lists the key shortcuts", () => {
    setup()
    expect(screen.getByRole("region", { name: "Welcome to SphereWiki" })).toBeTruthy()
    // A couple of the onboarding shortcut hints are present.
    expect(screen.getByText(/jump to any note/i)).toBeTruthy()
    expect(screen.getByText(/all keyboard shortcuts/i)).toBeTruthy()
  })

  it("creates the first note from the primary CTA", () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByRole("button", { name: /create your first note/i }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it("disables the CTA without write permission", () => {
    const { onCreate } = setup({ canCreate: false })
    const cta = screen.getByRole("button", { name: /create your first note/i })
    expect(cta.hasAttribute("disabled")).toBe(true)
    fireEvent.click(cta)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it("opens the shortcut help from the secondary action", () => {
    const { onShowShortcuts } = setup()
    fireEvent.click(screen.getByRole("button", { name: /keyboard shortcuts/i }))
    expect(onShowShortcuts).toHaveBeenCalledTimes(1)
  })

  it("offers the Trash only when there are deleted notes", () => {
    const { rerender } = render(
      <WelcomePanel canCreate onCreate={vi.fn()} onShowShortcuts={vi.fn()} deletedCount={0} />,
    )
    expect(screen.queryByText(/trash/i)).toBeNull()
    rerender(
      <WelcomePanel canCreate onCreate={vi.fn()} onShowShortcuts={vi.fn()} deletedCount={2} />,
    )
    expect(screen.getByText(/trash/i)).toBeTruthy()
  })
})
