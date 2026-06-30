/**
 * Prism KV Handoff Protocol — Destination Import Eligibility Tests
 *
 * Covers all 13 rejection classes and the success path.
 */

import { expect, test, describe } from "bun:test"
import { checkDestinationImportEligibility } from "../destination-import-eligibility"
import type { PrismKvHandoffRequest, DestinationRejectionClass } from "../handoff-types"

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
  active: boolean; instanceMatch: boolean; decodeSupported: boolean
  importSupported: boolean; artifactMatch: boolean; tokenizerMatch: boolean
  layoutCompatible: boolean; computeImageCompatible: boolean
  capacityOk: boolean; kvCapacityOk: boolean; notDraining: boolean
  notCancelled: boolean; notRevoked: boolean
}

const allTrue: FlagSet = {
  active: true, instanceMatch: true, decodeSupported: true,
  importSupported: true, artifactMatch: true, tokenizerMatch: true,
  layoutCompatible: true, computeImageCompatible: true,
  capacityOk: true, kvCapacityOk: true, notDraining: true,
  notCancelled: true, notRevoked: true,
}

function flags(values: Partial<FlagSet>): FlagSet {
  return { ...allTrue, ...values }
}

function toArgs(f: FlagSet): [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean] {
  return [
    f.active, f.instanceMatch, f.decodeSupported, f.importSupported,
    f.artifactMatch, f.tokenizerMatch, f.layoutCompatible,
    f.computeImageCompatible, f.capacityOk, f.kvCapacityOk,
    f.notDraining, f.notCancelled, f.notRevoked,
  ]
}

describe("checkDestinationImportEligibility", () => {
  test("all checks pass — eligible", () => {
    const result = checkDestinationImportEligibility(mockRequest(), ...toArgs(allTrue))
    expect(result.eligible).toBe(true)
    expect(result.rejectionClass).toBeNull()
    expect(result.reason).toBeNull()
  })

  const rejectionCases: { name: string; flag: keyof FlagSet; expected: DestinationRejectionClass }[] = [
    { name: "destination_worker_unavailable", flag: "active", expected: "destination_worker_unavailable" },
    { name: "destination_instance_mismatch", flag: "instanceMatch", expected: "destination_instance_mismatch" },
    { name: "destination_decode_unsupported", flag: "decodeSupported", expected: "destination_decode_unsupported" },
    { name: "destination_import_not_supported", flag: "importSupported", expected: "destination_import_not_supported" },
    { name: "destination_artifact_mismatch", flag: "artifactMatch", expected: "destination_artifact_mismatch" },
    { name: "destination_tokenizer_mismatch", flag: "tokenizerMatch", expected: "destination_tokenizer_mismatch" },
    { name: "destination_layout_incompatible", flag: "layoutCompatible", expected: "destination_layout_incompatible" },
    { name: "destination_compute_image_incompatible", flag: "computeImageCompatible", expected: "destination_compute_image_incompatible" },
    { name: "destination_capacity_exceeded", flag: "capacityOk", expected: "destination_capacity_exceeded" },
    { name: "destination_kv_capacity_exceeded", flag: "kvCapacityOk", expected: "destination_kv_capacity_exceeded" },
    { name: "destination_draining", flag: "notDraining", expected: "destination_draining" },
    { name: "request_cancelled", flag: "notCancelled", expected: "request_cancelled" },
    { name: "lease_revoked", flag: "notRevoked", expected: "lease_revoked" },
  ]

  for (const { name, flag, expected } of rejectionCases) {
    test(name, () => {
      const f = flags({ [flag]: false })
      const result = checkDestinationImportEligibility(mockRequest(), ...toArgs(f))
      expect(result.eligible).toBe(false)
      expect(result.rejectionClass).toBe(expected)
      expect(result.reason).toBeString()
    })
  }
})
