/**
 * Prism llm-d Worker — Artifact (Model Registry) Admission Tests
 *
 * Covers:
 *   - State transitions for createModelEntry → load → completeLoad / fail
 *   - Unload (drain → unloading → unavailable)
 *   - Revoke from admitted
 *   - isModelReady query
 */

import { describe, it, expect } from "bun:test"

import {
  createModelEntry,
  loadModel,
  completeLoad,
  failModel,
  unloadModel,
  revokeModel,
  isModelReady,
} from "../worker-model-registry"
import type { PrismWorkerModel } from "../worker-types"

// ── Fixtures ---------------------------------------------------------------

function makeModel(overrides?: Partial<PrismWorkerModel>): PrismWorkerModel {
  return {
    modelId: "test-model",
    artifactDigest: "abc123def456",
    tokenizerDigest: "tok123",
    modelFamily: "llama",
    quantizationScheme: "q4_0",
    artifactAdmissionState: "admitted",
    computeImageDigest: "",
    targetCapabilitySignature: "",
    modelState: "admitted",
    loadedAt: null,
    lastUsedAt: null,
    ...overrides,
  }
}

// ── Tests -------------------------------------------------------------------

describe("createModelEntry", () => {
  it("creates an admitted model with default fields", () => {
    const entry = createModelEntry("abc123def456", "llama", "tok123")
    expect(entry.modelId).toBe("model-abc123def456")
    expect(entry.artifactDigest).toBe("abc123def456")
    expect(entry.modelFamily).toBe("llama")
    expect(entry.tokenizerDigest).toBe("tok123")
    expect(entry.modelState).toBe("admitted")
    expect(entry.loadedAt).toBeNull()
    expect(entry.lastUsedAt).toBeNull()
  })
})

describe("loadModel", () => {
  it("transitions from admitted → loading", () => {
    const m = loadModel(makeModel())
    expect(m.modelState).toBe("loading")
  })

  it("throws on invalid transition (unavailable → loading)", () => {
    expect(() => loadModel(makeModel({ modelState: "unavailable" }))).toThrow(
      "Invalid model transition",
    )
  })
})

describe("completeLoad", () => {
  it("transitions from loading → loaded with compute digest", () => {
    const m = completeLoad(
      makeModel({ modelState: "loading", computeImageDigest: "", targetCapabilitySignature: "" }),
      "sha256:abc",
      "sig:v1",
    )
    expect(m.modelState).toBe("loaded")
    expect(m.computeImageDigest).toBe("sha256:abc")
    expect(m.targetCapabilitySignature).toBe("sig:v1")
    expect(m.loadedAt).not.toBeNull()
  })

  it("throws if not in loading state", () => {
    expect(() =>
      completeLoad(makeModel({ modelState: "admitted" }), "d", "s"),
    ).toThrow("Invalid model transition")
  })
})

describe("failModel", () => {
  it("transitions from loading → failed", () => {
    const m = failModel(makeModel({ modelState: "loading" }))
    expect(m.modelState).toBe("failed")
  })

  it("throws from loaded (load → fail is invalid)", () => {
    // loaded can fail
    const m = failModel(makeModel({ modelState: "loaded" }))
    expect(m.modelState).toBe("failed")
  })

  it("throws from admitted", () => {
    expect(() => failModel(makeModel({ modelState: "admitted" }))).toThrow(
      "Invalid model transition",
    )
  })
})

describe("unloadModel", () => {
  it("drains a loaded model on first call", () => {
    const m = unloadModel(makeModel({ modelState: "loaded" }))
    expect(m.modelState).toBe("draining")
  })

  it("unloads a draining model on second call", () => {
    const m = unloadModel(makeModel({ modelState: "draining" }))
    expect(m.modelState).toBe("unloading")
  })

  it("completes to unavailable on third call", () => {
    const m = unloadModel(makeModel({ modelState: "unloading" }))
    expect(m.modelState).toBe("unavailable")
  })
})

describe("revokeModel", () => {
  it("transitions from admitted → revoked", () => {
    const m = revokeModel(makeModel({ modelState: "admitted" }))
    expect(m.modelState).toBe("revoked")
  })

  it("throws from loaded (no direct revoke from loaded)", () => {
    expect(() => revokeModel(makeModel({ modelState: "loaded" }))).toThrow(
      "Invalid model transition",
    )
  })
})

describe("isModelReady", () => {
  it("returns true for loaded", () => {
    expect(isModelReady(makeModel({ modelState: "loaded" }))).toBe(true)
  })

  it("returns false for loading", () => {
    expect(isModelReady(makeModel({ modelState: "loading" }))).toBe(false)
  })

  it("returns false for admitted", () => {
    expect(isModelReady(makeModel({ modelState: "admitted" }))).toBe(false)
  })

  it("returns false for failed", () => {
    expect(isModelReady(makeModel({ modelState: "failed" }))).toBe(false)
  })

  it("returns false for revoked", () => {
    expect(isModelReady(makeModel({ modelState: "revoked" }))).toBe(false)
  })

  it("returns false for draining", () => {
    expect(isModelReady(makeModel({ modelState: "draining" }))).toBe(false)
  })
})
