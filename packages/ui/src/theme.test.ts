import { afterEach, describe, expect, it } from "vitest"
import { applyTheme, readTheme, storeTheme } from "./theme"

function memStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe("readTheme", () => {
  it("defaults to system when unset", () => {
    expect(readTheme(memStorage())).toBe("system")
  })

  it("reads a stored valid theme and ignores an invalid one", () => {
    const s = memStorage()
    s.setItem("spherewiki:theme", "dark")
    expect(readTheme(s)).toBe("dark")
    s.setItem("spherewiki:theme", "rainbow")
    expect(readTheme(s)).toBe("system")
  })
})

describe("storeTheme", () => {
  it("round-trips through storage", () => {
    const s = memStorage()
    storeTheme("light", s)
    expect(readTheme(s)).toBe("light")
  })
})

describe("applyTheme", () => {
  it("sets data-theme for an explicit choice and clears it for system", () => {
    const root = document.documentElement
    applyTheme("dark", root)
    expect(root.dataset.theme).toBe("dark")
    applyTheme("light", root)
    expect(root.dataset.theme).toBe("light")
    applyTheme("system", root)
    expect(root.dataset.theme).toBeUndefined() // system → no override, CSS @media decides
  })
})
