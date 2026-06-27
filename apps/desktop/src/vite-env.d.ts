/** Side-effect CSS imports (Vite bundles them; TS just needs the module to exist). */
declare module "*.css" {}

interface ImportMetaEnv {
  /** Super-peer WebSocket URL; when set, notes sync live through the server. */
  readonly VITE_SYNC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
