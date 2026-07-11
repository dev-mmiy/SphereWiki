import { NoteWorkspace } from "@spherewiki/editor"

/**
 * The web client. It renders the SAME `NoteWorkspace` as desktop (from `@spherewiki/editor`), so the
 * two clients can't drift. With no local filesystem, its vault is the browser's localStorage cache;
 * when `VITE_SYNC_URL` is set it joins the workspace live through the sync super-peer (the Y.Doc via
 * the super-peer is then the source of truth, the local cache serves offline). No `projects` prop →
 * no project switcher: the web client reaches one workspace at a time through the server, honoring
 * project isolation (there is no ambient "all notes" surface).
 */
export function WebApp() {
  return <NoteWorkspace />
}
