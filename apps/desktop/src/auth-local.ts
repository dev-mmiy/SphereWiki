import {
  type AuthProvider,
  asWorkspaceId,
  createMemoryAuth,
  type Role,
  type Session,
} from "@spherewiki/shared"

/**
 * Local mode — a first-class, offline single-user identity, not a throwaway dev stand-in.
 *
 * SphereWiki is local-first: the desktop app works fully standalone with no account and no
 * connectivity (the data plane — vault, versions, trash, search, the on-save AI — is all local).
 * `localAuth` is the identity that powers that mode. Real auth (WorkOS) and multi-user sync layer
 * *on top* of it later — signing in swaps this local session for a real account, but the local
 * data plane is identity-agnostic and keeps working — so this is a supported mode, not scaffolding
 * to delete. The workspace id is stable so the local stores (vault / versions / session / metrics,
 * all keyed by it) keep resolving across upgrades.
 */
export const WORKSPACE_ID = asWorkspaceId("ws-dev")

/** The local single-user session, with the given role in the local workspace. */
export function localAuth(role: Role = "editor"): AuthProvider {
  const session: Session = {
    account: { id: "local", email: "you@local" },
    orgId: "local-org",
    memberships: [{ workspaceId: WORKSPACE_ID, role }],
  }
  return createMemoryAuth(session)
}
