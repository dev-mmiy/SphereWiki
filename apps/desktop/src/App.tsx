import { appTitle } from "./app-info"
import { NoteEditor } from "./editor/NoteEditor"

export function App() {
  return (
    <main>
      <h1>{appTitle()}</h1>
      <NoteEditor />
    </main>
  )
}
