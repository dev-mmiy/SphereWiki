import type { WorkspaceId } from "../types"

export type Role = "admin" | "editor" | "viewer"

export interface Account {
  readonly id: string
  readonly email: string
}

export interface Membership {
  readonly workspaceId: WorkspaceId
  readonly role: Role
}

export interface Session {
  readonly account: Account
  readonly orgId: string
  readonly memberships: readonly Membership[]
}

/**
 * The identity boundary (control plane, AD-3). WorkOS AuthKit implements this in
 * production; a dev stub backs tests. The data plane never forges these.
 */
export interface AuthProvider {
  /** The current session, or null when signed out. */
  session(): Session | null
}
