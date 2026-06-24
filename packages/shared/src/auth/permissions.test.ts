import { describe, expect, it } from "vitest"
import { asWorkspaceId } from "../types"
import { can, roleFor } from "./permissions"
import type { Session } from "./types"

const ws1 = asWorkspaceId("ws1")
const ws2 = asWorkspaceId("ws2")

const session: Session = {
  account: { id: "u1", email: "a@example.com" },
  orgId: "org1",
  memberships: [{ workspaceId: ws1, role: "editor" }],
}

describe("permissions", () => {
  it("resolves the role for a member workspace", () => {
    expect(roleFor(session, ws1)).toBe("editor")
    expect(roleFor(session, ws2)).toBeNull()
  })

  it("grants by role rank", () => {
    expect(can(session, ws1, "read")).toBe(true)
    expect(can(session, ws1, "write")).toBe(true)
    expect(can(session, ws1, "admin")).toBe(false)
  })

  it("denies all access to a non-member workspace (isolation)", () => {
    expect(can(session, ws2, "read")).toBe(false)
    expect(can(session, ws2, "write")).toBe(false)
    expect(can(session, ws2, "admin")).toBe(false)
  })
})
