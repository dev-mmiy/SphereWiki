import { NoteWorkspace } from "./editor/NoteWorkspace"

// The app shell (top bar + 3-pane layout) lives in NoteWorkspace; App just mounts it.
export function App() {
  return <NoteWorkspace />
}
