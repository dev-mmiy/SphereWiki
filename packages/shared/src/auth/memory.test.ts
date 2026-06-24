import { describe, expect, it } from "vitest"
import { asWorkspaceId } from "../types"
import { createMemoryAuth } from "./memory"
import type { Session } from "./types"

describe("memory auth", () => {
  it("returns the configured session, or null when signed out", () => {
    expect(createMemoryAuth().session()).toBeNull()

    const session: Session = {
      account: { id: "u1", email: "a@example.com" },
      orgId: "org1",
      memberships: [{ workspaceId: asWorkspaceId("ws1"), role: "admin" }],
    }
    expect(createMemoryAuth(session).session()).toBe(session)
  })
})
