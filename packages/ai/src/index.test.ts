import { describe, expect, it } from "vitest"
import { EMBEDDING_MODEL } from "./index"

describe("@spherewiki/ai", () => {
  it("defaults to the e5-small on-device embedding model (AD-2)", () => {
    expect(EMBEDDING_MODEL).toBe("multilingual-e5-small")
  })
})
