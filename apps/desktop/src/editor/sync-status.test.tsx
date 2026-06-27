import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SyncStatus } from "./sync-status"

describe("SyncStatus", () => {
  it("labels each state and exposes it via data-status", () => {
    const { rerender } = render(<SyncStatus status="local" />)
    expect(screen.getByText("Local").closest(".sync-status")?.getAttribute("data-status")).toBe(
      "local",
    )

    rerender(<SyncStatus status="syncing" />)
    expect(screen.getByText("Syncing…")).toBeTruthy()

    rerender(<SyncStatus status="synced" />)
    const synced = screen.getByText("Synced").closest(".sync-status")
    expect(synced?.getAttribute("data-status")).toBe("synced")
  })
})
