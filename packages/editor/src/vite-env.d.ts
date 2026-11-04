// The editor reads its live-sync endpoint from the consuming app's Vite env (each client — desktop
// or web — injects its own at build time). Declared here (not via `vite/client`) so the package has
// no build-tool dependency. The token is fetched from the server (`POST /sync-token`), so the env
// carries only the endpoint URL — not a static room-auth token.
interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
