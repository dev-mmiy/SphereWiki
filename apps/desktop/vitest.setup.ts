import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount React trees between tests so renders don't leak across test cases.
afterEach(cleanup)
