import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { NoteWorkspace } from "./NoteWorkspace"

describe("NoteWorkspace", () => {
  it("mounts the CodeMirror editor at runtime", () => {
    const { container } = render(<NoteWorkspace />)
    expect(container.querySelector(".cm-editor")).not.toBeNull()
  })

  it("commits a version when the Commit button is clicked", () => {
    render(<NoteWorkspace />)
    expect(screen.queryAllByText(/revert/i)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: /commit version/i }))
    expect(screen.getAllByText(/revert/i).length).toBeGreaterThan(0)
  })
})
