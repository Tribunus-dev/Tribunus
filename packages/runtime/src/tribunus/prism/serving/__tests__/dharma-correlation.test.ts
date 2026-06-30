/**
 * Tests — Dharma Lease Correlation
 */

import { describe, it, expect } from "bun:test"
import { createCorrelation, validateCorrelation } from "../dharma-correlation"
import type { DharmaWorkerCorrelation } from "../worker-types"

describe("createCorrelation", () => {
  it("creates a correlation with all fields", () => {
    const corr = createCorrelation("lease-42", "session-7", "digest-alice", "standard")
    expect(corr.dharmaLeaseId).toBe("lease-42")
    expect(corr.sessionId).toBe("session-7")
    expect(corr.requesterIdentityDigest).toBe("digest-alice")
    expect(corr.disclosureClass).toBe("standard")
    expect(corr.resultBundleId).toBeNull()
  })
})

describe("validateCorrelation", () => {
  it("validates a matching correlation", () => {
    const corr = createCorrelation("lease-42", "session-7", "digest-alice", "standard")
    const result = validateCorrelation(corr, "lease-42", "session-7")
    expect(result.valid).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("rejects mismatched lease id", () => {
    const corr: DharmaWorkerCorrelation = {
      dharmaLeaseId: "lease-wrong",
      sessionId: "session-7",
      requesterIdentityDigest: "digest-alice",
      disclosureClass: "standard",
      resultBundleId: null,
    }
    const result = validateCorrelation(corr, "lease-42", "session-7")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("lease id mismatch")
  })

  it("rejects mismatched session id", () => {
    const corr: DharmaWorkerCorrelation = {
      dharmaLeaseId: "lease-42",
      sessionId: "session-wrong",
      requesterIdentityDigest: "digest-alice",
      disclosureClass: "standard",
      resultBundleId: null,
    }
    const result = validateCorrelation(corr, "lease-42", "session-7")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("session id mismatch")
  })

  it("rejects missing requester identity digest", () => {
    const corr: DharmaWorkerCorrelation = {
      dharmaLeaseId: "lease-42",
      sessionId: "session-7",
      requesterIdentityDigest: "",
      disclosureClass: "standard",
      resultBundleId: null,
    }
    const result = validateCorrelation(corr, "lease-42", "session-7")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("missing requester identity digest")
  })

  it("rejects missing disclosure class", () => {
    const corr: DharmaWorkerCorrelation = {
      dharmaLeaseId: "lease-42",
      sessionId: "session-7",
      requesterIdentityDigest: "digest-alice",
      disclosureClass: "",
      resultBundleId: null,
    }
    const result = validateCorrelation(corr, "lease-42", "session-7")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("missing disclosure class")
  })
})
