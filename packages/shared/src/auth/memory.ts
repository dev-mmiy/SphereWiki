import type { AuthProvider, Session } from "./types"

/** Dev/test auth provider with a fixed session. WorkOS AuthKit implements AuthProvider for real (AD-3). */
export function createMemoryAuth(session: Session | null = null): AuthProvider {
  return { session: () => session }
}
