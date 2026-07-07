import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { localAuth } from "../auth-local"
import { NoteWorkspace } from "./NoteWorkspace"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("NoteWorkspace", () => {
  it("renders the note list, editor, and commit control", () => {
    render(<NoteWorkspace />)
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Home" })).toBeTruthy()
    expect(document.querySelector(".cm-editor")).not.toBeNull()
    expect(screen.getByRole("button", { name: /commit version/i })).toBeTruthy()
  })

  it("switches the active note from the list", () => {
    render(<NoteWorkspace />)
    const nav = screen.getByRole("navigation")
    fireEvent.click(within(nav).getByRole("button", { name: "Ideas" }))
    expect(document.querySelector(".cm-editor")).not.toBeNull()
  })

  it("exposes the AI autonomy selector, defaulting to Auto", () => {
    render(<NoteWorkspace />)
    const mode = screen.getByRole("combobox", { name: "AI mode" }) as HTMLSelectElement
    expect(mode.value).toBe("auto")
    expect(within(mode).getByRole("option", { name: "Suggest" })).toBeTruthy()
  })

  it("folds the sidebar away and back (focus mode)", () => {
    render(<NoteWorkspace />)
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeNull()
    const toggle = screen.getByRole("button", { name: "Toggle sidebar" })
    fireEvent.click(toggle)
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeNull()
  })

  it("toggles the sidebar with Cmd/Ctrl-B", () => {
    render(<NoteWorkspace />)
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeNull()
    fireEvent.keyDown(document.body, { key: "b", metaKey: true })
    expect(screen.queryByRole("region", { name: "Search" })).toBeNull()
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true })
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeNull()
  })

  it("folds the details rail away and back (focus mode)", () => {
    render(<NoteWorkspace />)
    expect(screen.queryByRole("region", { name: "Workspace metrics" })).not.toBeNull()
    const toggle = screen.getByRole("button", { name: "Toggle details panel" })
    fireEvent.click(toggle)
    expect(screen.queryByRole("region", { name: "Workspace metrics" })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.queryByRole("region", { name: "Workspace metrics" })).not.toBeNull()
  })

  it("opens the quick switcher on Cmd-K and dismisses it on Escape", () => {
    render(<NoteWorkspace />)
    expect(screen.queryByRole("dialog", { name: "Quick switcher" })).toBeNull()
    // The shortcut is bound on window; a bubbling keydown from the document reaches it.
    fireEvent.keyDown(document.body, { key: "k", metaKey: true })
    expect(screen.getByRole("dialog", { name: "Quick switcher" })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Jump to note" }), { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Quick switcher" })).toBeNull()
  })

  it("opens the shortcut help on ? and not while typing into a field", () => {
    render(<NoteWorkspace />)
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull()
    // A bare "?" anywhere outside a field opens the help.
    fireEvent.keyDown(document.body, { key: "?" })
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Keyboard shortcuts" }), { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull()

    // "?" typed into an input must NOT hijack the keystroke into the help overlay.
    const search = screen.getByRole("region", { name: "Search" })
    const box = within(search).getByRole("searchbox", { name: "Search notes" })
    fireEvent.keyDown(box, { key: "?" })
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull()
  })

  it("commits a version when the Commit button is clicked (editor role)", () => {
    render(<NoteWorkspace />)
    expect(screen.queryAllByText(/revert/i)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: /commit version/i }))
    expect(screen.getAllByText(/revert/i).length).toBeGreaterThan(0)
  })

  it("shows the current user and enables editing for an editor", () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    expect(screen.getByText(/you@local/)).toBeTruthy()
    expect(document.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true")
    expect(
      (screen.getByRole("button", { name: /commit version/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it("offers Organize with AI for an editor and disables it for a viewer", () => {
    const { unmount } = render(<NoteWorkspace auth={localAuth("editor")} />)
    expect(
      (screen.getByRole("button", { name: /organize with ai/i }) as HTMLButtonElement).disabled,
    ).toBe(false)
    unmount()
    render(<NoteWorkspace auth={localAuth("viewer")} />)
    expect(
      (screen.getByRole("button", { name: /organize with ai/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("runs the agent, surfaces what it added, and attributes it in history", async () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    fireEvent.click(screen.getByRole("button", { name: /organize with ai/i }))
    expect(await screen.findByText(/AI added/)).toBeTruthy()
    expect(screen.getByText(/ai:on-save/)).toBeTruthy() // the AI version, attributed in history
  })

  it("shows an empty-tags hint, then surfaces AI-added tags in the Tags panel", async () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    const tagsRegion = screen.getByRole("region", { name: "Tags" })
    expect(within(tagsRegion).getByText(/no tags yet/i)).toBeTruthy() // seed Home has no tags
    fireEvent.click(screen.getByRole("button", { name: /organize with ai/i }))
    await screen.findByText(/AI added/)
    // The agent's auto-tags are now visible as #tag chips — the auto-tag value is observable.
    const chips = await within(tagsRegion).findAllByRole("button", { name: /^#/ })
    expect(chips.length).toBeGreaterThan(0)
  })

  it("lets an editor add a tag from the Tags panel (human + AI co-edit tags)", () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    const tagsRegion = screen.getByRole("region", { name: "Tags" })
    const input = within(tagsRegion).getByRole("textbox", { name: "Add tag" })
    fireEvent.change(input, { target: { value: "planning" } })
    fireEvent.submit(input.closest("form") as HTMLFormElement)
    expect(within(tagsRegion).getByRole("button", { name: "#planning" })).toBeTruthy()
  })

  it("hides tag editing for a viewer", () => {
    render(<NoteWorkspace auth={localAuth("viewer")} />)
    const tagsRegion = screen.getByRole("region", { name: "Tags" })
    expect(within(tagsRegion).queryByRole("textbox", { name: "Add tag" })).toBeNull()
  })

  it("shows a workspace metrics readout (graph growth)", () => {
    render(<NoteWorkspace />)
    const region = screen.getByRole("region", { name: "Workspace metrics" })
    // Seed has 3 cross-linked notes.
    expect(
      within(region).getByText("Notes").closest(".metric")?.querySelector("dd")?.textContent,
    ).toBe("3")
  })

  it("renders the workspace graph and navigates by clicking a node", () => {
    render(<NoteWorkspace />)
    const graph = screen.getByRole("region", { name: "Graph" })
    // Home is active initially, so its node is marked current.
    expect(
      within(graph).getByRole("button", { name: "Open Home" }).getAttribute("aria-current"),
    ).toBe("true")
    // Clicking the Ideas node navigates: the current marker moves to it.
    fireEvent.click(within(graph).getByRole("button", { name: "Open Ideas" }))
    expect(
      within(graph).getByRole("button", { name: "Open Ideas" }).getAttribute("aria-current"),
    ).toBe("true")
    expect(
      within(graph).getByRole("button", { name: "Open Home" }).getAttribute("aria-current"),
    ).toBeNull()
  })

  it("finds a note by content via the search box and navigates to it", () => {
    render(<NoteWorkspace />)
    const search = screen.getByRole("region", { name: "Search" })
    fireEvent.change(within(search).getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "brainstorm idea" }, // not in the seed; expect no matches first
    })
    expect(within(search).getByText(/no matches/i)).toBeTruthy()
    // "Welcome" appears only in Home's body → searching it finds Home.
    fireEvent.change(within(search).getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "welcome" },
    })
    const list = within(search).getByRole("list", { name: "Search results" })
    expect(within(list).getByRole("button", { name: "Home" })).toBeTruthy()
  })

  it("answers a workspace question with cited notes (RAG)", async () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    fireEvent.change(screen.getByLabelText(/ask the workspace/i), {
      target: { value: "auto links notes" },
    })
    fireEvent.click(screen.getByRole("button", { name: /^ask$/i }))
    const region = await screen.findByRole("region", { name: "Ask" })
    expect(await within(region).findByRole("button", { name: "Ideas" })).toBeTruthy()
  })

  it("deletes a note to the trash and restores it", () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
    fireEvent.click(within(nav).getByRole("button", { name: "Delete Ideas" }))
    expect(within(nav).queryByRole("button", { name: "Ideas" })).toBeNull() // gone from the list
    // Restorable from the trash.
    fireEvent.click(within(nav).getByRole("button", { name: "Restore Ideas" }))
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
  })

  it("shows the first-run welcome when every note is deleted, and creates from it", () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    const nav = screen.getByRole("navigation")
    // Delete all three seed notes (deleting the active one moves on to the next).
    for (const title of ["Home", "Getting Started", "Ideas"]) {
      fireEvent.click(within(nav).getByRole("button", { name: `Delete ${title}` }))
    }
    // The editor area is replaced by a guiding welcome, not left blank.
    const welcome = screen.getByRole("region", { name: "Welcome to SphereWiki" })
    // Because the empty state is the result of deletions, it points back to the Trash.
    expect(within(welcome).getByText(/trash/i)).toBeTruthy()
    // The CTA creates a note → back to editing.
    fireEvent.click(within(welcome).getByRole("button", { name: /create your first note/i }))
    expect(screen.queryByRole("region", { name: "Welcome to SphereWiki" })).toBeNull()
    expect(document.querySelector(".cm-editor")).not.toBeNull()
  })

  it("renames the active note from the list (inline input → relabel)", () => {
    // The rename affordance is an in-app inline input (Tauri's WKWebView can't show window.prompt).
    render(<NoteWorkspace auth={localAuth("editor")} />)
    const nav = screen.getByRole("navigation")
    expect(within(nav).getByRole("button", { name: "Home" })).toBeTruthy()
    fireEvent.click(within(nav).getByRole("button", { name: "Rename Home" }))
    const input = within(nav).getByLabelText("Rename Home")
    fireEvent.change(input, { target: { value: "Index" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(within(nav).getByRole("button", { name: "Index" })).toBeTruthy()
    expect(within(nav).queryByRole("button", { name: "Home" })).toBeNull()
  })

  it("does not rename when the inline editor is cancelled (Escape)", () => {
    render(<NoteWorkspace auth={localAuth("editor")} />)
    const nav = screen.getByRole("navigation")
    fireEvent.click(within(nav).getByRole("button", { name: "Rename Ideas" }))
    fireEvent.keyDown(within(nav).getByLabelText("Rename Ideas"), { key: "Escape" })
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
  })

  it("disables rename for a viewer and blocks the action", () => {
    render(<NoteWorkspace auth={localAuth("viewer")} />)
    const nav = screen.getByRole("navigation")
    const btn = within(nav).getByRole("button", { name: "Rename Ideas" }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn) // a disabled button must not fire onClick → no rename happens
    expect(within(nav).getByRole("button", { name: "Ideas" })).toBeTruthy()
    expect(within(nav).queryByRole("button", { name: "Hacked" })).toBeNull()
  })

  it("disables delete for a viewer", () => {
    render(<NoteWorkspace auth={localAuth("viewer")} />)
    const nav = screen.getByRole("navigation")
    expect(
      (within(nav).getByRole("button", { name: "Delete Ideas" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("is read-only for a viewer", () => {
    render(<NoteWorkspace auth={localAuth("viewer")} />)
    expect(document.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false")
    expect(
      (screen.getByRole("button", { name: /commit version/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
    const nav = screen.getByRole("navigation")
    expect(
      (within(nav).getByRole("button", { name: /new note/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
