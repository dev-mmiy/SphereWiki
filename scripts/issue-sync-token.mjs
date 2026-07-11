#!/usr/bin/env node
// Mint a workspace-scoped sync token for the super-peer (M3b P3). The bearer may join that
// workspace's rooms on a server configured with the SAME SPHEREWIKI_SYNC_SECRET — hand it to a
// client as VITE_SYNC_TOKEN. Until WorkOS gates issuance per membership (P3b), this is the manual,
// secret-holder-only way to mint tokens.
//
//   SPHEREWIKI_SYNC_SECRET=... node scripts/issue-sync-token.mjs <workspaceId> [ttlSeconds]
//
// @spherewiki/shared is imported as BUILT dist (raw Node, not vite/vitest) — run
// `pnpm --filter @spherewiki/shared build` first if it's stale.

import { issueWorkspaceToken } from "@spherewiki/shared"

const secret = process.env.SPHEREWIKI_SYNC_SECRET
const workspaceId = process.argv[2]
const ttlSeconds = process.argv[3] ? Number(process.argv[3]) : 30 * 24 * 3600 // 30 days (a dev token)

if (!secret) {
  console.error("error: set SPHEREWIKI_SYNC_SECRET (the same secret the server uses)")
  process.exit(1)
}
if (!workspaceId) {
  console.error(
    "usage: SPHEREWIKI_SYNC_SECRET=... node scripts/issue-sync-token.mjs <workspaceId> [ttlSeconds]",
  )
  process.exit(1)
}

const token = await issueWorkspaceToken(workspaceId, secret, { ttlSeconds })
// Just the token on stdout, so it composes: VITE_SYNC_TOKEN=$(SPHEREWIKI_SYNC_SECRET=... node ... ws-dev)
console.log(token)
