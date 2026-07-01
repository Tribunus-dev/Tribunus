/**
 * APU-dGPU Offload — Simulation Tests
 *
 * Validates the offload decision policy:
 * - APU remains the execution target for short (low-token-count) requests.
 * - dGPU is selected for long prefill requests.
 * - When dGPU is under pressure (high reserved memory), fallback to APU.
 */

import { expect, test, describe } from "bun:test"
import type {
  PrismComputeDevice,
  PrismMemoryDomainKind,
  PrismFabricPlacementMode,
  PrismMemoryTransportEdge,
} from "../fabric-types"
import {
  createDefaultDharmaFabricPolicy,
  createRestrictiveDharmaFabricPolicy,
  isDeviceClassAllowed,
  isOffloadPermitted,
} from "../dharma-fabric-policy"
import { selectTransportPath, getHandoffModeLabel } from "../fabric-handoff"

// ── Fixtures ────────────────────────────────────────────────────────────────

const APU_DOMAIN: PrismMemoryDomainKind = "apu_shared_memory"
const DGPU_DOMAIN: PrismMemoryDomainKind = "discrete_gpu_vram"
const CPU_DOMAIN: PrismMemoryDomainKind = "cpu_system_memory"

function makeApuDevice(availableBytes: number = 14_000_000_000): PrismComputeDevice {
  return {
    deviceId: "apu_gpu_0",
    deviceClass: "integrated_gpu",
    backendKind: "metal",
    targetCapabilitySignature: "sig_igpu_v2",
    memoryDomainIds: ["domain_apu_shared"],
    computeCapabilities: ["gpgpu", "matrix"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp"],
    availableMemoryBytes: availableBytes,
    reservedMemoryBytes: 2_000_000_000,
    healthState: "healthy",
  }
}

function makeDgpuDevice(
  availableBytes: number = 44_000_000_000,
  reservedBytes: number = 8_000_000_000,
): PrismComputeDevice {
  return {
    deviceId: "dgpu_0",
    deviceClass: "discrete_gpu",
    backendKind: "metal",
    targetCapabilitySignature: "sig_dgpu_v3",
    memoryDomainIds: ["domain_dgpu"],
    computeCapabilities: ["gpgpu", "matrix", "ray_tracing"],
    supportedWorkloads: ["prefill", "decode", "attention", "mlp"],
    availableMemoryBytes: availableBytes,
    reservedMemoryBytes: reservedBytes,
    healthState: "healthy",
  }
}

/** Edges connecting APU <-> CPU and APU <-> dGPU */
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

// ── Simulated Offload Decider ───────────────────────────────────────────────

type OffloadDecision = {
  targetDeviceId: string
  targetDomainId: string
  mode: PrismFabricPlacementMode
  reason: string
}

/**
 * Simulate the APU/dGPU offload decision logic based on input token count,
 * prompt length class, and dGPU pressure.
 */
function decideOffload(
  inputTokens: number,
  promptLengthClass: string,
  apu: PrismComputeDevice,
  dgpu: PrismComputeDevice,
): OffloadDecision {
  const defaultPolicy = createDefaultDharmaFabricPolicy()
  const dgpuPressure = dgpu.reservedMemoryBytes / (dgpu.availableMemoryBytes + dgpu.reservedMemoryBytes)

  // dGPU under pressure (> 30% reserved) — fall back to APU
  if (dgpuPressure > 0.3) {
    return {
      targetDeviceId: apu.deviceId,
      targetDomainId: "domain_apu_shared",
      mode: "apu_integrated_gpu",
      reason: "dGPU_pressure_fallback",
    }
  }

  // Short requests stay on APU (integrated GPU)
  if (inputTokens <= 1024 || promptLengthClass === "short") {
    return {
      targetDeviceId: apu.deviceId,
      targetDomainId: "domain_apu_shared",
      mode: "apu_integrated_gpu",
      reason: "short_request_apu",
    }
  }

  // Long/very long prefill — offload to dGPU
  if (inputTokens > 8192 || promptLengthClass === "very_long") {
    return {
      targetDeviceId: dgpu.deviceId,
      targetDomainId: "domain_dgpu",
      mode: "dGPU_offload",
      reason: "long_prefill_dgpu",
    }
  }

  // Medium — prefer dGPU if available and permitted
  return {
    targetDeviceId: dgpu.deviceId,
    targetDomainId: "domain_dgpu",
    mode: "dGPU_offload",
    reason: "medium_prefill_dgpu",
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("APU-dGPU Offload Decision", () => {
  test("short request stays on APU (1024 tokens, short class)", () => {
    const apu = makeApuDevice()
    const dgpu = makeDgpuDevice()
    const decision = decideOffload(1024, "short", apu, dgpu)
    expect(decision.targetDeviceId).toBe("apu_gpu_0")
    expect(decision.mode).toBe("apu_integrated_gpu")
    expect(decision.reason).toBe("short_request_apu")
  })

  test("very long prefill (16384 tokens) offloads to dGPU", () => {
    const apu = makeApuDevice()
    const dgpu = makeDgpuDevice()
    const decision = decideOffload(16384, "very_long", apu, dgpu)
    expect(decision.targetDeviceId).toBe("dgpu_0")
    expect(decision.mode).toBe("dGPU_offload")
    expect(decision.reason).toBe("long_prefill_dgpu")
  })

  test("medium prefill (4096 tokens) offloads to dGPU", () => {
    const apu = makeApuDevice()
    const dgpu = makeDgpuDevice()
    const decision = decideOffload(4096, "medium", apu, dgpu)
    expect(decision.targetDeviceId).toBe("dgpu_0")
    expect(decision.mode).toBe("dGPU_offload")
  })

  test("dGPU pressure (>30%) forces fallback to APU even for long prefill", () => {
    const apu = makeApuDevice()
    // dGPU with >30% reserved memory: 15 / (44 + 15) = 0.254 < 0.3
    // Use values that give >30%: 20 / (44 + 20) = 0.3125 > 0.3
    const dgpu = makeDgpuDevice(44_000_000_000, 20_000_000_000)
    const decision = decideOffload(16384, "very_long", apu, dgpu)
    expect(decision.targetDeviceId).toBe("apu_gpu_0")
    expect(decision.mode).toBe("apu_integrated_gpu")
    expect(decision.reason).toBe("dGPU_pressure_fallback")
  })

  test("long prefill (10000 tokens) offloads to dGPU", () => {
    const apu = makeApuDevice()
    const dgpu = makeDgpuDevice()
    const decision = decideOffload(10_000, "long", apu, dgpu)
    expect(decision.targetDeviceId).toBe("dgpu_0")
    expect(decision.mode).toBe("dGPU_offload")
  })
})

describe("APU-dGPU Policy Checks", () => {
  test("default policy permits dGPU offload", () => {
    expect(isOffloadPermitted(createDefaultDharmaFabricPolicy(), "discrete_gpu")).toBe(true)
  })

  test("restrictive policy forbids dGPU offload", () => {
    expect(isOffloadPermitted(createRestrictiveDharmaFabricPolicy(), "discrete_gpu")).toBe(false)
  })

  test("default policy allows integrated_gpu", () => {
    expect(isDeviceClassAllowed(createDefaultDharmaFabricPolicy(), "integrated_gpu")).toBe(true)
  })
})

describe("APU-dGPU Transport Path", () => {
  test("selects available path from APU → dGPU", () => {
    const edges = makeEdges()
    const path = selectTransportPath(APU_DOMAIN, DGPU_DOMAIN, edges)
    expect(path).not.toBeNull()
    expect(path!.availabilityState).toBe("available")
  })

  test("selects available path from CPU → dGPU", () => {
    const edges = makeEdges()
    const path = selectTransportPath(CPU_DOMAIN, DGPU_DOMAIN, edges)
    expect(path).not.toBeNull()
    expect(path!.availabilityState).toBe("available")
  })
})

describe("APU-dGPU Mode Labels", () => {
  test("APU → dGPU label is descriptive", () => {
    const label = getHandoffModeLabel(APU_DOMAIN, DGPU_DOMAIN)
    expect(label).toBe("APU Shared Memory → dGPU VRAM")
  })

  test("CPU → APU label is descriptive", () => {
    const label = getHandoffModeLabel(CPU_DOMAIN, APU_DOMAIN)
    expect(label).toBe("CPU System Memory → APU Shared Memory")
  })
})
