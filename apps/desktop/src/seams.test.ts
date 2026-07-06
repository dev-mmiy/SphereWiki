import { afterEach, describe, expect, it } from "vitest"
import { isTauri } from "./seams"

describe("isTauri", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__") // restore the global between tests
  })

  it("is false in a plain browser / jsdom (no Tauri globals)", () => {
    expect(isTauri()).toBe(false)
  })

  it("is true when the Tauri internals global is present (the WKWebView)", () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(isTauri()).toBe(true)
  })
})
