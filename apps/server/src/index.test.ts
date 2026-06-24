import { describe, expect, it } from "vitest"
import { SERVER_NAME } from "./index"

describe("@spherewiki/server", () => {
  it("exposes the server name", () => {
    expect(SERVER_NAME).toBe("spherewiki-server")
  })
})
