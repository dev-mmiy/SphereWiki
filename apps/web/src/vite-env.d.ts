/** Side-effect CSS imports (Vite bundles them; TS just needs the module to exist). */
declare module "*.css" {}

// The shared editor reads its live-sync endpoint from Vite env; declare it so this app's typecheck
// (which pulls the aliased editor source in) sees `import.meta.env`. Vite injects it at build time.
interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
  readonly VITE_SYNC_TOKEN?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
