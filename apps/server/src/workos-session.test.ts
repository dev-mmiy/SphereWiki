import { asWorkspaceId } from "@spherewiki/shared"
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it } from "vitest"
import {
  createWorkOSSessionVerifier,
  membershipsFromOrgMap,
  parseOrgWorkspaceMap,
  type WorkOSAccessClaims,
} from "./workos-session"

const CLIENT_ID = "client_test"
const ISSUER = `https://api.workos.com/user_management/${CLIENT_ID}`

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", use: "sig" }
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) }
}

function signToken(
  privateKey: CryptoKey,
  opts: { sub?: string; orgId?: string; issuer?: string; expiresIn?: string } = {},
): Promise<string> {
  const jwt = new SignJWT(opts.orgId !== undefined ? { org_id: opts.orgId } : {})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(opts.issuer ?? ISSUER)
    .setSubject(opts.sub ?? "user_1")
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
  return jwt.sign(privateKey)
}

const noMemberships = () => []

describe("WorkOS session verifier (P3b)", () => {
  it("verifies an AuthKit access token into a Session with resolved memberships", async () => {
    const { privateKey, jwks } = await makeKeys()
    const seen: WorkOSAccessClaims[] = []
    const verify = createWorkOSSessionVerifier({
      clientId: CLIENT_ID,
      jwks,
      memberships: (claims) => {
        seen.push(claims)
        return [{ workspaceId: asWorkspaceId("ws1"), role: "editor" }]
      },
    })
    const session = await verify(await signToken(privateKey, { sub: "user_1", orgId: "org_1" }))
    expect(session).not.toBeNull()
    expect(session?.account.id).toBe("user_1")
    expect(session?.orgId).toBe("org_1")
    expect(session?.memberships).toEqual([{ workspaceId: "ws1", role: "editor" }])
    expect(seen).toEqual([{ userId: "user_1", orgId: "org_1" }])
  })

  it("rejects a token from the wrong issuer", async () => {
    const { privateKey, jwks } = await makeKeys()
    const verify = createWorkOSSessionVerifier({
      clientId: CLIENT_ID,
      jwks,
      memberships: noMemberships,
    })
    const token = await signToken(privateKey, { issuer: "https://evil.example.com" })
    expect(await verify(token)).toBeNull()
  })

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeKeys()
    const verify = createWorkOSSessionVerifier({
      clientId: CLIENT_ID,
      jwks,
      memberships: noMemberships,
    })
    const token = await signToken(privateKey, { expiresIn: "-1h" })
    expect(await verify(token)).toBeNull()
  })

  it("rejects a token signed with a foreign key, and garbage input", async () => {
    const { jwks } = await makeKeys()
    const { privateKey: foreignKey } = await makeKeys()
    const verify = createWorkOSSessionVerifier({
      clientId: CLIENT_ID,
      jwks,
      memberships: noMemberships,
    })
    expect(await verify(await signToken(foreignKey))).toBeNull()
    expect(await verify("not-a-jwt")).toBeNull()
    expect(await verify("")).toBeNull()
  })

  it("handles a token with no org context (orgId null to the resolver)", async () => {
    const { privateKey, jwks } = await makeKeys()
    const seen: WorkOSAccessClaims[] = []
    const verify = createWorkOSSessionVerifier({
      clientId: CLIENT_ID,
      jwks,
      memberships: (claims) => {
        seen.push(claims)
        return []
      },
    })
    const session = await verify(await signToken(privateKey, { sub: "user_2" }))
    expect(session?.orgId).toBe("")
    expect(session?.memberships).toEqual([])
    expect(seen).toEqual([{ userId: "user_2", orgId: null }])
  })
})

describe("org→workspace membership map (interim until the P4 control plane)", () => {
  it("parses a valid map and resolves memberships per org", async () => {
    const map = parseOrgWorkspaceMap('{"org_1":{"ws1":"editor","shared-kb":"viewer"}}')
    const resolve = membershipsFromOrgMap(map)
    expect(await resolve({ userId: "u", orgId: "org_1" })).toEqual([
      { workspaceId: "ws1", role: "editor" },
      { workspaceId: "shared-kb", role: "viewer" },
    ])
    expect(await resolve({ userId: "u", orgId: "org_other" })).toEqual([])
    expect(await resolve({ userId: "u", orgId: null })).toEqual([])
  })

  it("fails loud on malformed configuration (never silently no-access)", () => {
    expect(() => parseOrgWorkspaceMap("not json")).toThrow()
    expect(() => parseOrgWorkspaceMap('["array"]')).toThrow()
    expect(() => parseOrgWorkspaceMap('{"org_1":"editor"}')).toThrow()
    expect(() => parseOrgWorkspaceMap('{"org_1":{"ws1":"owner"}}')).toThrow() // unknown role
  })
})
