import {
  type AuthProvider,
  asWorkspaceId,
  createMemoryAuth,
  type Role,
  type Session,
  type WorkspaceId,
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

/**
 * The local single-user session, with the given role in the given workspace (the active local
 * project). The local user OWNS every one of their projects, so the session must hold a membership
 * for whichever project is active — otherwise the permission-gated paths (the on-save AI agent
 * checks `can(session, activeProjectId, "write")`, and the index is sealed to that id) would fail
 * closed in every project except the default one. Defaults to the fixed local workspace so the
 * browser / single-vault case and existing callers are unchanged.
 */
export function localAuth(
  role: Role = "editor",
  workspaceId: WorkspaceId = WORKSPACE_ID,
): AuthProvider {
  const session: Session = {
    account: { id: "local", email: "you@local" },
    orgId: "local-org",
    memberships: [{ workspaceId, role }],
  }
  return createMemoryAuth(session)
}
