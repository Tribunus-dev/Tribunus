/**
 * Tests — Dharma handoff policy creation and enforcement
 */

import { describe, it, expect } from "bun:test"
import {
  createDefaultDharmaHandoffPolicy,
  createSimulationDharmaHandoffPolicy,
  isHandoffPolicySatisfied,
  isHandoffPermittedByLease,
} from "../handoff-dharma-policy"
import type { PrismKvHandoffRequest, DharmaPrismHandoffPolicy } from "../handoff-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

const simulationRequest: PrismKvHandoffRequest = {
  handoffId: "h-001",
  routeId: "r-001",
  requestId: "req-001",
  executionId: "exec-001",
  sessionId: null,
  dharmaLeaseId: null,
  sourceWorkerId: "worker-p-1",
  sourceWorkerInstanceId: "inst-p1",
  destinationWorkerId: "worker-d-2",
  destinationWorkerInstanceId: "inst-d2",
  sourceKvNamespaceId: "ns-prefill-abc",
  modelArtifactDigest: "sha256-model-aaa",
  tokenizerDigest: "sha256-tok-bbb",
  sourceComputeImageDigest: "img-v1",
  destinationComputeImageDigest: "img-v2",
  handoffMode: "simulation_only",
  sourceRetentionPolicy: "retain_until_destination_commit",
  requestedDeadlineAt: "2025-06-01T00:00:00Z",
  requestedBy: "coordinator-1",
  authorizationDigest: "auth-xyz",
  createdAt: "2025-06-01T00:00:00Z",
  signature: null,
}

const transportRequest: PrismKvHandoffRequest = {
  ...simulationRequest,
  handoffMode: "future_transport_required",
}

const matchedImagesRequest: PrismKvHandoffRequest = {
  ...simulationRequest,
  sourceComputeImageDigest: "img-v1",
  destinationComputeImageDigest: "img-v1",
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createDefaultDharmaHandoffPolicy", () => {
  it("disallows simulated handoff by default", () => {
    const policy = createDefaultDharmaHandoffPolicy()
    expect(policy.allowSimulatedHandoff).toBeFalse()
    expect(policy.allowFutureTransportHandoff).toBeTrue()
    expect(policy.requireHandoffReceipt).toBeTrue()
    expect(policy.sourceRetentionPolicy).toBe("retain_until_destination_commit")
    expect(policy.requiredArtifactParityMode).toBe("strict")
  })
})

describe("createSimulationDharmaHandoffPolicy", () => {
  it("allows simulated handoff", () => {
    const policy = createSimulationDharmaHandoffPolicy()
    expect(policy.allowSimulatedHandoff).toBeTrue()
    expect(policy.allowFutureTransportHandoff).toBeTrue()
    expect(policy.requiredArtifactParityMode).toBe("evaluation")
  })
})

describe("isHandoffPolicySatisfied", () => {
  it("rejects simulation request under default policy", () => {
    const policy = createDefaultDharmaHandoffPolicy()
    const result = isHandoffPolicySatisfied(policy, simulationRequest)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("simulated_handoff_not_permitted")
  })

  it("allows simulation request under simulation policy", () => {
    const policy = createSimulationDharmaHandoffPolicy()
    const result = isHandoffPolicySatisfied(policy, matchedImagesRequest)
    expect(result.satisfied).toBeTrue()
    expect(result.reason).toBeNull()
  })

  it("rejects transport request when future transport disallowed", () => {
    const policy: DharmaPrismHandoffPolicy = {
      ...createDefaultDharmaHandoffPolicy(),
      allowFutureTransportHandoff: false,
    }
    const result = isHandoffPolicySatisfied(policy, transportRequest)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("future_transport_handoff_not_permitted")
  })

  it("rejects when source worker is not in whitelist", () => {
    const policy: DharmaPrismHandoffPolicy = {
      ...createDefaultDharmaHandoffPolicy(),
      allowSimulatedHandoff: true,
      allowedSourceWorkers: ["worker-allowed"],
    }
    const result = isHandoffPolicySatisfied(policy, matchedImagesRequest)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("source_worker_not_allowed")
  })

  it("rejects when destination worker is not in whitelist", () => {
    const policy: DharmaPrismHandoffPolicy = {
      ...createDefaultDharmaHandoffPolicy(),
      allowSimulatedHandoff: true,
      allowedSourceWorkers: ["worker-p-1"],
      allowedDestinationWorkers: ["worker-allowed"],
    }
    const result = isHandoffPolicySatisfied(policy, matchedImagesRequest)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("destination_worker_not_allowed")
  })

  it("accepts when both workers are whitelisted", () => {
    const policy: DharmaPrismHandoffPolicy = {
      ...createDefaultDharmaHandoffPolicy(),
      allowSimulatedHandoff: true,
      allowedSourceWorkers: ["worker-p-1"],
      allowedDestinationWorkers: ["worker-d-2"],
    }
    const result = isHandoffPolicySatisfied(policy, matchedImagesRequest)
    expect(result.satisfied).toBeTrue()
    expect(result.reason).toBeNull()
  })

  it("rejects strict mode with mismatched compute images", () => {
    const policy: DharmaPrismHandoffPolicy = {
      ...createDefaultDharmaHandoffPolicy(),
      allowSimulatedHandoff: true,
      requiredArtifactParityMode: "strict",
    }

    // simulationRequest has img-v1 vs img-v2 under strict mode
    const result = isHandoffPolicySatisfied(policy, simulationRequest)
    expect(result.satisfied).toBeFalse()
    expect(result.reason).toContain("artifact_parity_mismatch")
  })
})

describe("isHandoffPermittedByLease", () => {
  it("returns true for simulation mode under simulation policy", () => {
    const policy = createSimulationDharmaHandoffPolicy()
    expect(isHandoffPermittedByLease(policy, "simulation_only")).toBeTrue()
  })

  it("returns false for simulation mode under default policy", () => {
    const policy = createDefaultDharmaHandoffPolicy()
    expect(isHandoffPermittedByLease(policy, "simulation_only")).toBeFalse()
  })

  it("returns false for unknown mode", () => {
    const policy = createDefaultDharmaHandoffPolicy()
    expect(isHandoffPermittedByLease(policy, "unknown")).toBeFalse()
  })
})
