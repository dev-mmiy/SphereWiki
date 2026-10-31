import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Project } from "../projects/types"
import { ProjectSwitcher } from "./project-switcher"

const proj = (
  id: string,
  name: string,
  type: "project" | "shared" = "project",
  ragIncludes: readonly string[] = [],
): Project => ({ id, name, type, ragIncludes })

const noop = () => {}

describe("ProjectSwitcher — shared-scope settings (multi-project 2b-2)", () => {
  it("shows no settings affordance without onUpdate (read-only switcher)", () => {
    render(
      <ProjectSwitcher
        projects={[proj("ws-dev", "Default")]}
        activeId="ws-dev"
        onSwitch={noop}
        onCreate={noop}
      />,
    )
    expect(screen.queryByRole("button", { name: "Project settings" })).toBeNull()
  })

  it("marks the active project as a shared knowledge workspace", () => {
    const onUpdate = vi.fn()
    render(
      <ProjectSwitcher
        projects={[proj("ws-dev", "Default")]}
        activeId="ws-dev"
        onSwitch={noop}
        onCreate={noop}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Shared knowledge workspace" }))
    expect(onUpdate).toHaveBeenCalledWith("ws-dev", { type: "shared" })
  })

  it("lets a project opt into a shared workspace, reflecting the current selection", () => {
    const onUpdate = vi.fn()
    render(
      <ProjectSwitcher
        projects={[proj("p-1", "Client A"), proj("s-1", "Common", "shared")]}
        activeId="p-1"
        onSwitch={noop}
        onCreate={noop}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }))
    const box = screen.getByRole("checkbox", { name: "Common" }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(onUpdate).toHaveBeenCalledWith("p-1", { ragIncludes: ["s-1"] })
  })

  it("removes an included shared workspace when unchecked", () => {
    const onUpdate = vi.fn()
    render(
      <ProjectSwitcher
        projects={[proj("p-1", "Client A", "project", ["s-1"]), proj("s-1", "Common", "shared")]}
        activeId="p-1"
        onSwitch={noop}
        onCreate={noop}
        onUpdate={onUpdate}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }))
    const box = screen.getByRole("checkbox", { name: "Common" }) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(onUpdate).toHaveBeenCalledWith("p-1", { ragIncludes: [] })
  })

  it("a shared workspace has no include list (a source consumes nothing)", () => {
    render(
      <ProjectSwitcher
        projects={[proj("s-1", "Common", "shared"), proj("s-2", "Other", "shared")]}
        activeId="s-1"
        onSwitch={noop}
        onCreate={noop}
        onUpdate={noop}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Project settings" }))
    expect(
      (screen.getByRole("checkbox", { name: "Shared knowledge workspace" }) as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(screen.queryByRole("group", { name: "Include shared knowledge" })).toBeNull()
    expect(screen.queryByRole("checkbox", { name: "Other" })).toBeNull() // never lists another shared ws
  })

  it("labels shared workspaces in the dropdown", () => {
    render(
      <ProjectSwitcher
        projects={[proj("p-1", "Client A"), proj("s-1", "Common", "shared")]}
        activeId="p-1"
        onSwitch={noop}
        onCreate={noop}
        onUpdate={noop}
      />,
    )
    expect(screen.getByRole("option", { name: "Common (shared)" })).toBeTruthy()
    expect(screen.getByRole("option", { name: "Client A" })).toBeTruthy()
  })
})

describe("ProjectSwitcher — active-project header (makes a switch visible)", () => {
  it("shows the active project as a PROJECT chip with its scope line", () => {
    const { container } = render(
      <ProjectSwitcher
        projects={[proj("ws-dev", "Default")]}
        activeId="ws-dev"
        onSwitch={noop}
        onCreate={noop}
        noteCount={3}
      />,
    )
    expect(container.querySelector(".project-chip")?.textContent).toBe("project")
    expect(container.querySelector(".project-scope")?.textContent).toBe("3 notes")
  })

  it("shows a SHARED chip for a shared workspace", () => {
    const { container } = render(
      <ProjectSwitcher
        projects={[proj("shared-a", "Org", "shared")]}
        activeId="shared-a"
        onSwitch={noop}
        onCreate={noop}
        noteCount={0}
      />,
    )
    expect(container.querySelector(".project-chip--shared")?.textContent).toBe("shared")
    expect(container.querySelector(".project-scope")?.textContent).toBe("0 notes")
  })

  it("lists the shared workspaces the active project reads (RAG scope) as chips", () => {
    render(
      <ProjectSwitcher
        projects={[
          proj("shared-a", "Org", "shared"),
          proj("ws-dev", "Default", "project", ["shared-a"]),
        ]}
        activeId="ws-dev"
        onSwitch={noop}
        onCreate={noop}
        noteCount={5}
      />,
    )
    expect(screen.getByText("Includes · read-only")).toBeTruthy()
    expect(screen.getByText("Org")).toBeTruthy()
    expect(screen.getByText(/5 notes · 1 shared/)).toBeTruthy()
  })

  it("shows no Includes section when the project reads nothing shared", () => {
    render(
      <ProjectSwitcher
        projects={[proj("shared-a", "Org", "shared"), proj("ws-dev", "Default")]}
        activeId="ws-dev"
        onSwitch={noop}
        onCreate={noop}
      />,
    )
    expect(screen.queryByText("Includes · read-only")).toBeNull()
    expect(screen.queryByText("Org")).toBeNull()
  })
})
