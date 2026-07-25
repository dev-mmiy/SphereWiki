// WorkOS-backed session verification (M3b P3b). AuthKit's login flow leaves the client holding an
// access token — an RS256 JWT signed by WorkOS — which it presents to `/sync-token` as its bearer
// credential. This module verifies that JWT against WorkOS's JWKS (issuer-pinned per client id) and
// builds the shared `Session` from its claims. WorkOS authenticates WHO the caller is; workspace
// memberships stay OUR control plane's authority — resolved by the injected `MembershipResolver`
// (an env-configured org→workspace map until the real membership store lands in P4).

import { asWorkspaceId, type Membership, type Role } from "@spherewiki/shared"
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose"
import type { SessionVerifier } from "./token-endpoint"

/** The identity claims we consume from a verified AuthKit access token. */
export interface WorkOSAccessClaims {
  /** WorkOS user id (the JWT `sub`). */
  readonly userId: string
  /** WorkOS organization id (`org_id`), or null when the session carries no org context. */
  readonly orgId: string | null
}

/** Resolves a verified identity's workspace memberships — the control plane's authority, not WorkOS's. */
export type MembershipResolver = (
  claims: WorkOSAccessClaims,
) => readonly Membership[] | Promise<readonly Membership[]>

export interface WorkOSSessionVerifierOptions {
  /** The WorkOS client id — drives the default JWKS URL and the expected token issuer. */
  clientId: string
  /** Resolves workspace memberships for a verified identity. */
  memberships: MembershipResolver
  /** Override the verification key set (tests inject a local JWKS); defaults to WorkOS's remote JWKS. */
  jwks?: JWTVerifyGetKey
  /** Override the expected issuer; defaults to WorkOS user management for `clientId`. */
  issuer?: string
}

/**
 * A `SessionVerifier` that accepts a WorkOS AuthKit access token. Any verification failure —
 * malformed, expired, wrong issuer, foreign signature — yields `null` (signed out), never a throw.
 */
export function createWorkOSSessionVerifier(
  options: WorkOSSessionVerifierOptions,
): SessionVerifier {
  const issuer = options.issuer ?? `https://api.workos.com/user_management/${options.clientId}`
  const jwks =
    options.jwks ??
    createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${options.clientId}`))
  return async (bearer) => {
    let payload: Record<string, unknown>
    try {
      payload = (await jwtVerify(bearer, jwks, { issuer })).payload
    } catch {
      return null
    }
    const userId = payload.sub
    if (typeof userId !== "string" || userId === "") return null
    const orgId =
      typeof payload.org_id === "string" && payload.org_id !== "" ? payload.org_id : null
    const memberships = await options.memberships({ userId, orgId })
    return {
      account: { id: userId, email: typeof payload.email === "string" ? payload.email : "" },
      orgId: orgId ?? "",
      memberships,
    }
  }
}

/** org id → (workspace id → role). The interim membership source (env JSON) until P4's store. */
export type OrgWorkspaceMap = Readonly<Record<string, Readonly<Record<string, Role>>>>

const ROLES: readonly Role[] = ["admin", "editor", "viewer"]

/**
 * Parse the `SPHEREWIKI_ORG_WORKSPACES` JSON (`{"org_x":{"ws1":"editor"}}`). Throws a descriptive
 * error on any malformed shape — a misconfigured access map must fail the server loudly at startup,
 * never degrade into silent no-access (mirroring the empty-secret startup guard).
 */
export function parseOrgWorkspaceMap(json: string): OrgWorkspaceMap {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`SPHEREWIKI_ORG_WORKSPACES is not valid JSON: ${String(error)}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SPHEREWIKI_ORG_WORKSPACES must be a JSON object of org id → workspace map")
  }
  for (const [org, workspaces] of Object.entries(parsed)) {
    if (typeof workspaces !== "object" || workspaces === null || Array.isArray(workspaces)) {
      throw new Error(
        `SPHEREWIKI_ORG_WORKSPACES["${org}"] must be an object of workspace id → role`,
      )
    }
    for (const [ws, role] of Object.entries(workspaces)) {
      if (!ROLES.includes(role as Role)) {
        throw new Error(
          `SPHEREWIKI_ORG_WORKSPACES["${org}"]["${ws}"] has unknown role "${String(role)}" (expected ${ROLES.join(" | ")})`,
        )
      }
    }
  }
  return parsed as OrgWorkspaceMap
}

/** Memberships for an identity = the configured workspaces of its organization (none without an org). */
export function membershipsFromOrgMap(map: OrgWorkspaceMap): MembershipResolver {
  return ({ orgId }) => {
    const workspaces = orgId === null ? undefined : map[orgId]
    if (workspaces === undefined) return []
    return Object.entries(workspaces).map(([workspaceId, role]) => ({
      workspaceId: asWorkspaceId(workspaceId),
      role,
    }))
  }
}
