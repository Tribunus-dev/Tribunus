/**
 * Heterogeneous Host Simulation — End-to-End Topology → Placement → Handoff → Receipt → Policy
 *
 * Simulates a synthetic heterogeneous host with CPU, APU (iGPU), NPU, and dGPU
 * domains, runs through topology discovery, path selection, placement decisions,
 * handoff creation, execution receipt generation, and policy validation.
 */

import { expect, test, describe, beforeEach } from "bun:test"
import type {
  PrismTopologyGraph,
  PrismComputeDevice,
  PrismMemoryDomainInfo,
  PrismMemoryTransportEdge,
  PrismMemoryDomainKind,
  PrismFabricPlacementDecision,
  PrismFabricPlacementMode,
} from "../fabric-types"
import { createFabricKvHandoffRequest, validateFabricHandoffCompatibility } from "../fabric-handoff"
import {
  createFabricExecutionReceipt,
  addTransportPath,
  addKvResidency,
  signReceipt,
  isReceiptComplete,
  _resetReceiptCounter,
} from "../fabric-receipts"
import { createDefaultDharmaFabricPolicy, isDeviceClassAllowed, isTransportWithinPolicy } from "../dharma-fabric-policy"
import { _resetHandoffCounter } from "../fabric-handoff"

// ── Fixtures ────────────────────────────────────────────────────────────────

const GENERATION = 1
const HOST_ID = "host_hetero_001"

function makeCpu(): PrismComputeDevice {
  return {
    deviceId: "cpu_0",
    deviceClass: "cpu",
    backendKind: "cpu_native",
    targetCapabilitySignature: "sig_cpu_v1",
    memoryDomainIds: ["domain_cpu"],
    computeCapabilities: ["scalar", "simd"],
    supportedWorkloads: ["embedding", "tokenization", "postprocessing"],
    availableMemoryBytes: 64_000_000_000,
    reservedMemoryBytes: 4_000_000_000,
    healthState: "healthy",
  }
}

function makeApuGpu(): PrismComputeDevice {
  return {
    deviceId: "apu_gpu_0",
    deviceClass: "integrated_gpu",
    backendKind: "metal",
    targetCapabilitySignature: "sig_igpu_v2",
    memoryDomainIds: ["domain_apu_shared"],
    computeCapabilities: ["gpgpu", "matrix"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp"],
    availableMemoryBytes: 16_000_000_000,
    reservedMemoryBytes: 2_000_000_000,
    healthState: "healthy",
  }
}

function makeNpu(): PrismComputeDevice {
  return {
    deviceId: "npu_0",
    deviceClass: "npu",
    backendKind: "metal",
    targetCapabilitySignature: "sig_npu_v1",
    memoryDomainIds: ["domain_npu"],
    computeCapabilities: ["neural_engine", "matrix"],
    supportedWorkloads: ["attention", "mlp", "norm", "embedding"],
    availableMemoryBytes: 8_000_000_000,
    reservedMemoryBytes: 1_000_000_000,
    healthState: "healthy",
  }
}

function makeDgpu(): PrismComputeDevice {
  return {
    deviceId: "dgpu_0",
    deviceClass: "discrete_gpu",
    backendKind: "metal",
    targetCapabilitySignature: "sig_dgpu_v3",
    memoryDomainIds: ["domain_dgpu"],
    computeCapabilities: ["gpgpu", "matrix", "ray_tracing"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp"],
    availableMemoryBytes: 48_000_000_000,
    reservedMemoryBytes: 4_000_000_000,
    healthState: "healthy",
  }
}

function makeDomains(): PrismMemoryDomainInfo[] {
  return [
    { domainId: "domain_cpu", domainKind: "cpu_system_memory", deviceIds: ["cpu_0"], totalBytes: 64_000_000_000, usedBytes: 8_000_000_000, reservedBytes: 4_000_000_000, allocationGranularity: 4096 },
    { domainId: "domain_apu_shared", domainKind: "apu_shared_memory", deviceIds: ["cpu_0", "apu_gpu_0"], totalBytes: 16_000_000_000, usedBytes: 4_000_000_000, reservedBytes: 2_000_000_000, allocationGranularity: 16384 },
    { domainId: "domain_npu", domainKind: "npu_shared_memory", deviceIds: ["npu_0"], totalBytes: 8_000_000_000, usedBytes: 1_000_000_000, reservedBytes: 1_000_000_000, allocationGranularity: 16384 },
    { domainId: "domain_dgpu", domainKind: "discrete_gpu_vram", deviceIds: ["dgpu_0"], totalBytes: 48_000_000_000, usedBytes: 12_000_000_000, reservedBytes: 8_000_000_000, allocationGranularity: 65536 },
  ]
}

function makeEdges(): PrismMemoryTransportEdge[] {
  return [
    {
      edgeId: "edge_cpu_to_apu",
      sourceDomainId: "domain_cpu",
      destinationDomainId: "domain_apu_shared",
      transportKind: "direct_shared_access",
      accessMode: "read_write",
      coherencyMode: "coherent",
      maximumBytes: 16_000_000_000,
      measuredBandwidthBytesPerSecond: 60_000_000_000,
      measuredLatencyMicroseconds: 3,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
    {
      edgeId: "edge_apu_to_npu",
      sourceDomainId: "domain_apu_shared",
      destinationDomainId: "domain_npu",
      transportKind: "direct_shared_access",
      accessMode: "read_write",
      coherencyMode: "io_coherent",
      maximumBytes: 8_000_000_000,
      measuredBandwidthBytesPerSecond: 30_000_000_000,
      measuredLatencyMicroseconds: 8,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
    {
      edgeId: "edge_apu_to_dgpu",
      sourceDomainId: "domain_apu_shared",
      destinationDomainId: "domain_dgpu",
      transportKind: "pinned_host_copy",
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: 48_000_000_000,
      measuredBandwidthBytesPerSecond: 20_000_000_000,
      measuredLatencyMicroseconds: 50,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
    {
      edgeId: "edge_cpu_to_dgpu",
      sourceDomainId: "domain_cpu",
      destinationDomainId: "domain_dgpu",
      transportKind: "pinned_host_copy",
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: 48_000_000_000,
      measuredBandwidthBytesPerSecond: 15_000_000_000,
      measuredLatencyMicroseconds: 80,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: true,
      availabilityState: "available",
    },
  ]
}

function buildTopology(): PrismTopologyGraph {
  return {
    hostInstanceId: HOST_ID,
    topologyGeneration: GENERATION,
    discoveredAt: new Date().toISOString(),
    devices: [makeCpu(), makeApuGpu(), makeNpu(), makeDgpu()],
    memoryDomains: makeDomains(),
    transportEdges: makeEdges(),
    interconnects: [],
    capabilitySignatures: ["sig_cpu_v1", "sig_igpu_v2", "sig_npu_v1", "sig_dgpu_v3"],
    measuredBandwidthClasses: [
      { className: "high", minimumBytesPerSecond: 50_000_000_000, maximumBytesPerSecond: 100_000_000_000 },
      { className: "medium", minimumBytesPerSecond: 10_000_000_000, maximumBytesPerSecond: 50_000_000_000 },
      { className: "low", minimumBytesPerSecond: 0, maximumBytesPerSecond: 10_000_000_000 },
    ],
    measuredLatencyClasses: [
      { className: "low", minimumMicroseconds: 0, maximumMicroseconds: 10 },
      { className: "medium", minimumMicroseconds: 10, maximumMicroseconds: 100 },
      { className: "high", minimumMicroseconds: 100, maximumMicroseconds: 10_000 },
    ],
    policyRestrictions: [],
  }
}

function makePlacementDecision(deviceId: string, domainId: string, mode: PrismFabricPlacementMode): PrismFabricPlacementDecision {
  return {
    decisionId: `decision_${deviceId}`,
    selectedDeviceId: deviceId,
    selectedMemoryDomainId: domainId,
    selectedTransportPath: [],
    sourceResidency: null,
    destinationResidency: "apu_shared_memory",
    estimatedTransferCost: 100,
    estimatedExecutionCost: 500,
    expectedKvReuse: true,
    fallbackDecisionIds: [],
    policyBasis: "dharma_v1",
    decisionReason: `Place on ${deviceId}`,
  }
}

// ── Test ────────────────────────────────────────────────────────────────────

describe("Heterogeneous Host Simulation", () => {
  beforeEach(() => {
    _resetHandoffCounter()
    _resetReceiptCounter()
  })

  test("full end-to-end: topology → placement → handoff → receipt → policy", () => {
    // 1. Topology
    const topology = buildTopology()
    expect(topology.devices).toHaveLength(4)
    expect(topology.memoryDomains).toHaveLength(4)
    expect(topology.transportEdges).toHaveLength(4)

    const devices = topology.devices
    const cpu = devices.find((d) => d.deviceClass === "cpu")!
    const apuGpu = devices.find((d) => d.deviceClass === "integrated_gpu")!
    const dgpu = devices.find((d) => d.deviceClass === "discrete_gpu")!
    const npu = devices.find((d) => d.deviceClass === "npu")!
    expect(cpu).toBeDefined()
    expect(apuGpu).toBeDefined()
    expect(dgpu).toBeDefined()
    expect(npu).toBeDefined()

    // 2. Dharma policy — default, all allowed
    const policy = createDefaultDharmaFabricPolicy()
    expect(isDeviceClassAllowed(policy, "integrated_gpu")).toBe(true)
    expect(isDeviceClassAllowed(policy, "discrete_gpu")).toBe(true)
    expect(isDeviceClassAllowed(policy, "npu")).toBe(true)

    // 3. Transport within policy
    const transferBytes = 4_194_304 // 4 MiB KV slice
    for (const edge of topology.transportEdges) {
      expect(isTransportWithinPolicy(policy, edge.transportKind, transferBytes)).toBe(true)
    }

    // 4. Placement decision — simulate APU → dGPU offload
    const mode: PrismFabricPlacementMode = "dGPU_offload"
    const placement = makePlacementDecision(dgpu.deviceId, "domain_dgpu", mode)
    expect(placement.selectedDeviceId).toBe("dgpu_0")
    expect(placement.policyBasis).toBe("dharma_v1")

    // 5. Create handoff request
    const handoff = createFabricKvHandoffRequest(
      apuGpu.deviceId,
      "domain_apu_shared",
      dgpu.deviceId,
      "domain_dgpu",
    )
    const compat = validateFabricHandoffCompatibility(handoff)
    expect(compat.valid).toBe(true)

    // 6. Create execution receipt
    const receipt = createFabricExecutionReceipt(
      handoff.handoffId,
      "route_prefill_001",
      dgpu.deviceId,
      "domain_dgpu",
      "prefill",
      mode,
    )
    expect(receipt.receiptId).toBe("receipt_1")
    expect(receipt.finalState).toBe("pending")
    expect(isReceiptComplete(receipt)).toBe(false) // not yet signed

    // 7. Attach transport path and residency
    const edges = topology.transportEdges.filter((e) => e.destinationDomainId === "domain_dgpu")
    const withPath = addTransportPath(receipt, edges)
    expect(withPath.transportPath).toHaveLength(2)

    const withResidency = addKvResidency(withPath, "apu_shared_memory", "discrete_gpu_vram")
    expect(withResidency.kvResidencyBefore).toBe("apu_shared_memory")
    expect(withResidency.kvResidencyAfter).toBe("discrete_gpu_vram")

    // 8. Sign and complete
    const signed = signReceipt(withResidency, "sig_abcd1234")
    const completed = {
      ...signed,
      executionDurationMs: 450,
      finalState: "completed" as const,
    }
    expect(isReceiptComplete(completed)).toBe(true)
    expect(completed.signature).toBe("sig_abcd1234")
  })
})
