import { appTitle } from "./app-info"
import { NoteWorkspace } from "./editor/NoteWorkspace"

export function App() {
  return (
    <main>
      <h1>{appTitle()}</h1>
      <NoteWorkspace />
    </main>
  )
}
