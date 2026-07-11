// @spherewiki/editor — the shared note-editing workspace (browser-safe): the `useVaultWorkspace`
// hook (vault + CRDT sync + versions + AI seams) and the `NoteWorkspace` UI, reused by the desktop
// (Tauri) and web clients so their behavior can never drift. Platform glue (the on-disk Tauri vault,
// the project registry's persistence) stays in the app that owns it and is injected via props.

export { appTitle } from "./app-info"
export { localAuth, WORKSPACE_ID } from "./auth-local"
export { NoteWorkspace } from "./editor/NoteWorkspace"
export {
  SEED,
  type UseVaultWorkspaceOptions,
  useVaultWorkspace,
  type VaultWorkspace,
} from "./editor/use-vault-workspace"
export type { Project, ProjectType } from "./projects/types"
export type { SyncStorage } from "./state/types"
export { connectRegistryToServer } from "./sync/connect-registry"
// The CRDT sync transports + local-persistence seams — `NoteWorkspace` wires these itself, but a host
// (or a test) can inject/override them.
export { connectNoteToServer } from "./sync/connect-server"
export { connectLocalPersistence } from "./sync/local-persistence"
export {
  type ConnectRegistryPersistence,
  connectRegistryPersistence,
} from "./sync/registry-persistence"
