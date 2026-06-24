import { describe, expect, it } from "vitest"
import { APP_NAME } from "./index"

describe("@spherewiki/desktop", () => {
  it("exposes the app name", () => {
    expect(APP_NAME).toBe("SphereWiki")
  })
})
