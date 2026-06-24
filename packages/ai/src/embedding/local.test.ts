import { describe, expect, it } from "vitest"
import { createLocalEmbedder, LOCAL_EMBEDDING_DIM } from "./local"

function cosine(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
  return sum
}

describe("createLocalEmbedder", () => {
  const embedder = createLocalEmbedder()

  it("is deterministic", async () => {
    const [a] = await embedder.embed(["the quick brown fox"])
    const [b] = await embedder.embed(["the quick brown fox"])
    expect(a).toEqual(b)
  })

  it("produces L2-normalized vectors", async () => {
    const [v] = await embedder.embed(["alpha beta gamma"])
    if (v === undefined) throw new Error("no vector")
    expect(Math.sqrt(cosine(v, v))).toBeCloseTo(1, 5)
  })

  it("scores related texts above disjoint ones", async () => {
    const [base, related, disjoint] = await embedder.embed([
      "cats and dogs are common pets",
      "dogs and cats are popular pets",
      "lattice gauge quantum chromodynamics",
    ])
    if (base === undefined || related === undefined || disjoint === undefined) {
      throw new Error("missing vectors")
    }
    expect(cosine(base, related)).toBeGreaterThan(cosine(base, disjoint))
  })

  it("embeds a batch identically to one-by-one", async () => {
    const texts = ["one apple", "two pears", "three plums"]
    const batch = await embedder.embed(texts)
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      if (text === undefined) throw new Error("missing text")
      const [single] = await embedder.embed([text])
      expect(batch[i]).toEqual(single)
    }
  })

  it("uses the model dimension", async () => {
    const [v] = await embedder.embed(["x"])
    expect(v?.length).toBe(LOCAL_EMBEDDING_DIM)
    expect(embedder.info.dimension).toBe(LOCAL_EMBEDDING_DIM)
  })

  it("returns a zero vector (no NaN) for symbol-only text", async () => {
    const [v] = await embedder.embed(["   "])
    if (v === undefined) throw new Error("no vector")
    expect(v.every((x) => x === 0)).toBe(true)
  })
})
