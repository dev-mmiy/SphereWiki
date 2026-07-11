/** The synchronous `Storage` slice the version store / session prefs / metrics recorders consume.
 * A platform supplies it: the desktop's on-disk `.spherewiki/` sidecar under Tauri, or webview
 * `localStorage` in the browser. Kept as a minimal structural type so the editor stays platform-free. */
export type SyncStorage = Pick<Storage, "getItem" | "setItem">
