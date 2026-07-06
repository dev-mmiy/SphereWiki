/**
 * The runtime host seam. The same `apps/desktop` bundle runs BOTH as the browser web build and
 * inside the Tauri WKWebView; `isTauri()` picks the backend at runtime so Tauri-only code (fs vault,
 * DuckDB, native APIs) is reached only under the native shell — the web build / Playwright E2E /
 * jsdom tests never touch `@tauri-apps/api`.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}
