/**
 * Prism KV Handoff Protocol — Source Export Eligibility Tests
 *
 * Covers all 13 rejection classes and the success path.
 */

import { expect, test, describe } from "bun:test"
import { checkSourceExportEligibility } from "../source-export-eligibility"
import type { PrismKvHandoffRequest, SourceRejectionClass } from "../handoff-types"

function mockRequest(overrides: Partial<PrismKvHandoffRequest> = {}): PrismKvHandoffRequest {
  return {
    handoffId: "handoff-001",
    routeId: "route-abc",
    requestId: "req-001",
    executionId: "exec-001",
    sessionId: "sess-001",
    dharmaLeaseId: "lease-001",
    sourceWorkerId: "worker-a",
    sourceWorkerInstanceId: "inst-a",
    destinationWorkerId: "worker-b",
    destinationWorkerInstanceId: "inst-b",
    sourceKvNamespaceId: "ns-001",
    modelArtifactDigest: "digest-model-001",
    tokenizerDigest: "digest-tok-001",
    sourceComputeImageDigest: "img-src-001",
    destinationComputeImageDigest: "img-dst-001",
    handoffMode: "simulation_only",
    sourceRetentionPolicy: "release_after_destination_commit",
    requestedDeadlineAt: new Date(Date.now() + 3600000).toISOString(),
    requestedBy: "user-test",
    authorizationDigest: "auth-digest",
    createdAt: new Date().toISOString(),
    signature: null,
    ...overrides,
  } satisfies PrismKvHandoffRequest
}

interface FlagSet {
  active: boolean; instanceMatch: boolean; pinValid: boolean; nsExists: boolean
  nsExportable: boolean; prefillComplete: boolean; nsNotInvalidated: boolean
  notCancelled: boolean; notRevoked: boolean; artifactMatch: boolean
  tokenizerMatch: boolean; capacityOk: boolean; exportSupported: boolean
}

const allTrue: FlagSet = {
  active: true, instanceMatch: true, pinValid: true, nsExists: true,
  nsExportable: true, prefillComplete: true, nsNotInvalidated: true,
  notCancelled: true, notRevoked: true, artifactMatch: true,
  tokenizerMatch: true, capacityOk: true, exportSupported: true,
}

function flags(values: Partial<FlagSet>): FlagSet {
  return { ...allTrue, ...values }
}

function toArgs(f: FlagSet): [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean] {
  return [f.active, f.instanceMatch, f.pinValid, f.nsExists, f.nsExportable, f.prefillComplete, f.nsNotInvalidated, f.notCancelled, f.notRevoked, f.artifactMatch, f.tokenizerMatch, f.capacityOk, f.exportSupported]
}

describe("checkSourceExportEligibility", () => {
  test("all checks pass — eligible", () => {
    const result = checkSourceExportEligibility(mockRequest(), ...toArgs(allTrue))
    expect(result.eligible).toBe(true)
    expect(result.rejectionClass).toBeNull()
    expect(result.reason).toBeNull()
  })

  const rejectionCases: { name: string; flag: keyof FlagSet; expected: SourceRejectionClass }[] = [
    { name: "source_worker_unavailable", flag: "active", expected: "source_worker_unavailable" },
    { name: "source_instance_mismatch", flag: "instanceMatch", expected: "source_instance_mismatch" },
    { name: "source_execution_pin_invalid", flag: "pinValid", expected: "source_execution_pin_invalid" },
    { name: "source_namespace_missing", flag: "nsExists", expected: "source_namespace_missing" },
    { name: "source_namespace_not_exportable", flag: "nsExportable", expected: "source_namespace_not_exportable" },
    { name: "prefill_not_completed", flag: "prefillComplete", expected: "prefill_not_completed" },
    { name: "source_namespace_invalidated", flag: "nsNotInvalidated", expected: "source_namespace_invalidated" },
    { name: "request_cancelled", flag: "notCancelled", expected: "request_cancelled" },
    { name: "lease_revoked", flag: "notRevoked", expected: "lease_revoked" },
    { name: "artifact_mismatch", flag: "artifactMatch", expected: "artifact_mismatch" },
    { name: "tokenizer_mismatch", flag: "tokenizerMatch", expected: "tokenizer_mismatch" },
    { name: "source_capacity_exceeded", flag: "capacityOk", expected: "source_capacity_exceeded" },
    { name: "handoff_export_not_supported", flag: "exportSupported", expected: "handoff_export_not_supported" },
  ]

  for (const { name, flag, expected } of rejectionCases) {
    test(name, () => {
      const f = flags({ [flag]: false })
      const result = checkSourceExportEligibility(mockRequest(), ...toArgs(f))
      expect(result.eligible).toBe(false)
      expect(result.rejectionClass).toBe(expected)
      expect(result.reason).toBeString()
    })
  }
})
