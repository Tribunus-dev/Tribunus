/**
 * Tests for compute-artifact.ts — artifact admission lifecycle.
 */

import { describe, it, expect } from "bun:test"
import {
  createArtifact,
  admitArtifact,
  revokeArtifact,
  isArtifactAdmitted,
  canArtifactSatisfyWorkload,
  isArtifactAvailableLocally,
} from "../compute-artifact.ts"
import type { PrismArtifactAdmission } from "../compute-types.ts"

// ── createArtifact ----------------------------------------------------------

describe("createArtifact", () => {
  it("creates an artifact in pending_validation state", () => {
    const art = createArtifact("sha256:abc", "llama-3b", "llama", "3.0")
    expect(art.artifactDigest).toBe("sha256:abc")
    expect(art.artifactName).toBe("llama-3b")
    expect(art.modelFamily).toBe("llama")
    expect(art.modelVersion).toBe("3.0")
    expect(art.admissionState).toBe("pending_validation")
    expect(art.revokedAt).toBeNull()
    expect(art.supportedWorkloadClasses).toEqual([])
    expect(() => new Date(art.admittedAt)).not.toThrow()
  })
})

// ── admitArtifact -----------------------------------------------------------

describe("admitArtifact", () => {
  it("transitions from pending_validation to admitted", () => {
    const art = createArtifact("d1", "m", "f", "1")
    const admitted = admitArtifact(art)
    expect(admitted.admissionState).toBe("admitted")
    expect(admitted.localAvailability).toBe("staged")
  })

  it("throws if artifact is already admitted", () => {
    const art = admitArtifact(createArtifact("d2", "m", "f", "1"))
    expect(() => admitArtifact(art)).toThrow("Cannot admit artifact")
  })

  it("throws if artifact is revoked", () => {
    const art = revokeArtifact(admitArtifact(createArtifact("d3", "m", "f", "1")))
    expect(() => admitArtifact(art)).toThrow("Cannot admit artifact")
  })

  it("throws if artifact is unavailable", () => {
    // Simulate an artifact already in unavailable state
    const art: PrismArtifactAdmission = {
      ...createArtifact("d4", "m", "f", "1"),
      admissionState: "unavailable",
    }
    expect(() => admitArtifact(art)).toThrow("Cannot admit artifact")
  })
})

// ── revokeArtifact ----------------------------------------------------------

describe("revokeArtifact", () => {
  it("transitions from admitted to revoked", () => {
    const art = admitArtifact(createArtifact("d5", "m", "f", "1"))
    const revoked = revokeArtifact(art)
    expect(revoked.admissionState).toBe("revoked")
    expect(revoked.revokedAt).not.toBeNull()
    expect(() => new Date(revoked.revokedAt!)).not.toThrow()
  })

  it("transitions from deprecated to revoked", () => {
    const art: PrismArtifactAdmission = {
      ...createArtifact("d6", "m", "f", "1"),
      admissionState: "deprecated",
    }
    const revoked = revokeArtifact(art)
    expect(revoked.admissionState).toBe("revoked")
  })

  it("throws from pending_validation", () => {
    expect(() => revokeArtifact(createArtifact("d7", "m", "f", "1"))).toThrow("Cannot revoke artifact")
  })

  it("throws from unknown", () => {
    const art: PrismArtifactAdmission = {
      ...createArtifact("d8", "m", "f", "1"),
      admissionState: "unknown",
    }
    expect(() => revokeArtifact(art)).toThrow("Cannot revoke artifact")
  })
})

// ── isArtifactAdmitted ------------------------------------------------------

describe("isArtifactAdmitted", () => {
  it("returns true for admitted artifacts", () => {
    expect(isArtifactAdmitted(admitArtifact(createArtifact("d9", "m", "f", "1")))).toBe(true)
  })

  it("returns false for pending_validation", () => {
    expect(isArtifactAdmitted(createArtifact("d10", "m", "f", "1"))).toBe(false)
  })

  it("returns false for revoked", () => {
    expect(isArtifactAdmitted(revokeArtifact(admitArtifact(createArtifact("d11", "m", "f", "1"))))).toBe(false)
  })
})

// ── canArtifactSatisfyWorkload ----------------------------------------------

describe("canArtifactSatisfyWorkload", () => {
  it("returns true when workload is in supported list", () => {
    const art: PrismArtifactAdmission = {
      ...createArtifact("d12", "m", "f", "1"),
      supportedWorkloadClasses: ["chat_completion", "embedding"],
    }
    expect(canArtifactSatisfyWorkload(art, "chat_completion")).toBe(true)
    expect(canArtifactSatisfyWorkload(art, "embedding")).toBe(true)
  })

  it("returns false when workload is not supported", () => {
    const art: PrismArtifactAdmission = {
      ...createArtifact("d13", "m", "f", "1"),
      supportedWorkloadClasses: ["chat_completion"],
    }
    expect(canArtifactSatisfyWorkload(art, "code_completion")).toBe(false)
  })

  it("returns false when supported list is empty", () => {
    expect(canArtifactSatisfyWorkload(createArtifact("d14", "m", "f", "1"), "chat_completion")).toBe(false)
  })
})

// ── isArtifactAvailableLocally ----------------------------------------------

describe("isArtifactAvailableLocally", () => {
  it("returns true when availability is 'staged'", () => {
    const art: PrismArtifactAdmission = {
      ...createArtifact("d15", "m", "f", "1"),
      localAvailability: "staged",
    }
    expect(isArtifactAvailableLocally(art)).toBe(true)
  })

  it("returns true when availability is 'unknown'", () => {
    expect(isArtifactAvailableLocally(createArtifact("d16", "m", "f", "1"))).toBe(true)
  })

  it("returns false when availability is 'unavailable'", () => {
    const art: PrismArtifactAdmission = {
      ...createArtifact("d17", "m", "f", "1"),
      localAvailability: "unavailable",
    }
    expect(isArtifactAvailableLocally(art)).toBe(false)
  })
})
