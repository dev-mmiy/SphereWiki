import { describe, expect, it } from "vitest"
import { appTitle } from "./app-info"

describe("appTitle", () => {
  it("is SphereWiki", () => {
    expect(appTitle()).toBe("SphereWiki")
  })
})
