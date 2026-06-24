import type { WorkspaceId } from "../types"
import type { Role, Session } from "./types"

export type Action = "read" | "write" | "admin"

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 }
const REQUIRED: Record<Action, number> = { read: 1, write: 2, admin: 3 }

/** The session's role in a workspace, or null if it is not a member. */
export function roleFor(session: Session, workspaceId: WorkspaceId): Role | null {
  return session.memberships.find((m) => m.workspaceId === workspaceId)?.role ?? null
}

/**
 * Whether the session may perform an action in a workspace. A non-member always
 * gets `false` — the auth-layer expression of absolute project isolation.
 */
export function can(session: Session, workspaceId: WorkspaceId, action: Action): boolean {
  const role = roleFor(session, workspaceId)
  return role !== null && RANK[role] >= REQUIRED[action]
}
