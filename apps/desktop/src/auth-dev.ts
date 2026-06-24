import {
  type AuthProvider,
  asWorkspaceId,
  createMemoryAuth,
  type Role,
  type Session,
} from "@spherewiki/shared"

/** The in-memory dev vault stands in for a single workspace until real auth/sync land (M3b). */
export const WORKSPACE_ID = asWorkspaceId("ws-dev")

/** Dev auth: a fixed local session with the given role in the dev workspace. */
export function devAuth(role: Role = "editor"): AuthProvider {
  const session: Session = {
    account: { id: "local", email: "you@local" },
    orgId: "org-dev",
    memberships: [{ workspaceId: WORKSPACE_ID, role }],
  }
  return createMemoryAuth(session)
}
