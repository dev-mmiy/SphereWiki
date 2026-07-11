// The editor reads its live-sync endpoint from the consuming app's Vite env (each client — desktop
// or web — injects its own at build time). Declared here (not via `vite/client`) so the package has
// no build-tool dependency; both apps already expose these vars.
interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
  readonly VITE_SYNC_TOKEN?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
