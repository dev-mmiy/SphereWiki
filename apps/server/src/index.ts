import { createFilePersistence } from "./file-persistence"
import { createSyncServer, createWorkspaceTokenAuthorizer } from "./sync-server"
import type { TokenIssuerOptions } from "./token-endpoint"
import {
  createWorkOSSessionVerifier,
  membershipsFromOrgMap,
  parseOrgWorkspaceMap,
} from "./workos-session"

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.SPHEREWIKI_DATA_DIR ?? ".spherewiki-data"

// Access control (P3): when SPHEREWIKI_SYNC_SECRET is set, every join must present a valid
// workspace-scoped token (issued with the same secret) whose workspace matches the room — otherwise
// the connection is rejected. UNSET → OPEN rooms (the zero-config local/dev default). A public
// deployment MUST set the secret; leaving it unset there means anyone can join any room they name.
const secretEnv = process.env.SPHEREWIKI_SYNC_SECRET
// A set-but-EMPTY secret is a misconfiguration (an operator meant to enable auth but the value is
// blank, which would silently fall through to OPEN). Refuse to start rather than fail open. Only a
// genuinely-unset variable means "open on purpose".
if (secretEnv !== undefined && secretEnv.trim() === "") {
  throw new Error(
    "SPHEREWIKI_SYNC_SECRET is set but empty — refusing to start with silently-open rooms. Unset it to run open (dev), or give it a strong value.",
  )
}
const secret = secretEnv

// Token issuance (P3b): with WORKOS_CLIENT_ID set, `POST /sync-token` verifies the caller's WorkOS
// AuthKit access token and mints a workspace-scoped sync token — but only for workspaces the
// caller's org is granted in SPHEREWIKI_ORG_WORKSPACES (the interim membership map until P4's
// membership store). Requires the sync secret: issuing tokens for open rooms is meaningless, and a
// half-configured deploy should fail loudly rather than appear protected.
const workosClientId = process.env.WORKOS_CLIENT_ID
if (workosClientId !== undefined && secret === undefined) {
  throw new Error(
    "WORKOS_CLIENT_ID is set but SPHEREWIKI_SYNC_SECRET is not — token issuance without token-gated rooms protects nothing. Set the secret too.",
  )
}
let tokenIssuer: TokenIssuerOptions | undefined
if (workosClientId !== undefined && secret !== undefined) {
  // Malformed membership JSON throws here — refuse to start over silently granting no one access.
  const orgMap = parseOrgWorkspaceMap(process.env.SPHEREWIKI_ORG_WORKSPACES ?? "{}")
  tokenIssuer = {
    secret,
    verifySession: createWorkOSSessionVerifier({
      clientId: workosClientId,
      memberships: membershipsFromOrgMap(orgMap),
    }),
  }
}

const server = createSyncServer({
  port,
  // Durable per-room persistence on the local filesystem (Cloud SQL/GCS slot in later).
  persistence: createFilePersistence(dataDir),
  ...(secret ? { authorize: createWorkspaceTokenAuthorizer(secret) } : {}),
  ...(tokenIssuer ? { tokenIssuer } : {}),
})
await server.listen()
console.log(
  `[spherewiki] sync super-peer listening on ${server.webSocketURL} (data: ${dataDir}, auth: ${
    secret ? "token-gated" : "OPEN"
  }, token issuance: ${tokenIssuer ? "WorkOS (/sync-token)" : "off"})`,
)
