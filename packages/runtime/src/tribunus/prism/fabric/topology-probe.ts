/**
 * Prism Heterogeneous Memory Fabric — Topology Probe
 *
 * Functions that construct synthetic topology graphs mimicking host probing.
 * These produce realistic fabric configurations for simulation and testing.
 */

import {
  type PrismTopologyGraph,
  type PrismComputeDevice,
  type PrismMemoryDomainInfo,
  type PrismMemoryTransportEdge,
  type PrismMemoryDomainKind,
  type PrismMemoryTransportKind,
  type PrismDeviceClass,
  type BackendKind,
} from "./fabric-types"
import { createEmptyTopologyGraph, addDeviceToGraph, addMemoryDomain, addTransportEdge } from "./topology-graph"
import { createDevice } from "./device-registry"
import { createMemoryDomain } from "./memory-domain"
import { createTransportEdge } from "./transport-edge"

// ── CPU-Only Host ───────────────────────────────────────────────────────────

/**
 * Build a topology graph for a CPU-only host (no GPU, no NPU, no accelerator).
 */
export function probeCpuOnlyHost(): PrismTopologyGraph {
  let graph = createEmptyTopologyGraph("cpu-only-host")

  const cpu = createDevice("cpu0", "cpu", "cpu_native", 32 * 1024 * 1024 * 1024)
  cpu.memoryDomainIds = ["sysmem"]
  cpu.computeCapabilities = ["cpu_native"]
  cpu.supportedWorkloads = ["tokenization", "postprocessing"]
  graph = addDeviceToGraph(graph, cpu)

  const sysmem = createMemoryDomain("sysmem", "cpu_system_memory", 32 * 1024 * 1024 * 1024)
  sysmem.deviceIds = ["cpu0"]
  graph = addMemoryDomain(graph, sysmem)

  return graph
}

// ── APU Host ────────────────────────────────────────────────────────────────

/**
 * Build a topology graph for an APU (integrated) host, optionally including an NPU.
 *
 * The APU topology includes:
 *   - CPU with system memory
 *   - Integrated GPU sharing memory via apu_shared_memory
 *   - Optional NPU with npu_shared_memory
 *   - Direct shared access edges between domains
 */
export function probeApuHost(includeNpu: boolean): PrismTopologyGraph {
  let graph = createEmptyTopologyGraph("apu-host")

  // CPU
  const cpu = createDevice("cpu0", "cpu", "cpu_native", 16 * 1024 * 1024 * 1024)
  cpu.memoryDomainIds = ["sysmem", "apu_shared0"]
  cpu.computeCapabilities = ["cpu_native"]
  cpu.supportedWorkloads = ["tokenization", "postprocessing", "norm"]
  graph = addDeviceToGraph(graph, cpu)

  // System memory
  const sysmem = createMemoryDomain("sysmem", "cpu_system_memory", 16 * 1024 * 1024 * 1024)
  sysmem.deviceIds = ["cpu0"]
  graph = addMemoryDomain(graph, sysmem)

  // APU shared memory (unified)
  const sharedMem = createMemoryDomain("apu_shared0", "apu_shared_memory", 16 * 1024 * 1024 * 1024)
  sharedMem.deviceIds = ["cpu0", "igpu0"]
  graph = addMemoryDomain(graph, sharedMem)

  // Integrated GPU
  const igpu = createDevice("igpu0", "integrated_gpu", "rocm", 8 * 1024 * 1024 * 1024)
  igpu.memoryDomainIds = ["apu_shared0", "igpu_local0"]
  igpu.computeCapabilities = ["rocm", "shared_memory"]
  igpu.supportedWorkloads = ["prefill", "decode", "embedding", "attention", "mlp", "norm"]
  graph = addDeviceToGraph(graph, igpu)

  // iGPU local alias
  const igpuLocal = createMemoryDomain("igpu_local0", "integrated_gpu_local_alias", 8 * 1024 * 1024 * 1024)
  igpuLocal.deviceIds = ["igpu0"]
  graph = addMemoryDomain(graph, igpuLocal)

  // Direct shared access: sysmem <-> apu_shared
  graph = addTransportEdge(graph,
    createTransportEdge("edge_sysmem_to_apu_shared", "sysmem", "apu_shared0", "direct_shared_access"))
  graph = addTransportEdge(graph,
    createTransportEdge("edge_apu_shared_to_sysmem", "apu_shared0", "sysmem", "direct_shared_access"))
  graph = addTransportEdge(graph,
    createTransportEdge("edge_apu_shared_to_igpu_local", "apu_shared0", "igpu_local0", "zero_copy_mapped_access"))
  graph = addTransportEdge(graph,
    createTransportEdge("edge_igpu_local_to_apu_shared", "igpu_local0", "apu_shared0", "zero_copy_mapped_access"))

  // Mark all edges available
  graph = updateAllEdges(graph, "available")

  if (!includeNpu) {
    return graph
  }

  // NPU
  const npu = createDevice("npu0", "npu", "rocm", 4 * 1024 * 1024 * 1024)
  npu.memoryDomainIds = ["npu_shared0"]
  npu.computeCapabilities = ["rocm", "npu_inference"]
  npu.supportedWorkloads = ["embedding", "norm", "attention"]
  graph = addDeviceToGraph(graph, npu)

  // NPU shared memory
  const npuMem = createMemoryDomain("npu_shared0", "npu_shared_memory", 4 * 1024 * 1024 * 1024)
  npuMem.deviceIds = ["npu0"]
  graph = addMemoryDomain(graph, npuMem)

  // sysmem <-> npu_shared
  graph = addTransportEdge(graph,
    createTransportEdge("edge_sysmem_to_npu_shared", "sysmem", "npu_shared0", "direct_shared_access"))
  graph = addTransportEdge(graph,
    createTransportEdge("edge_npu_shared_to_sysmem", "npu_shared0", "sysmem", "direct_shared_access"))

  graph = updateAllEdges(graph, "available")

  return graph
}

// ── dGPU Host ───────────────────────────────────────────────────────────────

/**
 * Build a topology graph for a discrete GPU host.
 *
 * Includes:
 *   - CPU with system memory
 *   - N discrete GPUs, each with its own VRAM domain
 *   - Pinned host memory domain
 *   - Transport edges: pinned_host_copy between sysmem/pinned and vram,
 *     peer_device_copy between VRAM domains
 */
export function probeDgpuHost(dgpuCount: number): PrismTopologyGraph {
  let graph = createEmptyTopologyGraph("dgpu-host")

  const cpu = createDevice("cpu0", "cpu", "cpu_native", 64 * 1024 * 1024 * 1024)
  cpu.memoryDomainIds = ["sysmem", "pinned_host0"]
  cpu.computeCapabilities = ["cpu_native"]
  cpu.supportedWorkloads = ["tokenization", "postprocessing"]
  graph = addDeviceToGraph(graph, cpu)

  const sysmem = createMemoryDomain("sysmem", "cpu_system_memory", 64 * 1024 * 1024 * 1024)
  sysmem.deviceIds = ["cpu0"]
  graph = addMemoryDomain(graph, sysmem)

  const pinned = createMemoryDomain("pinned_host0", "pinned_host_memory", 4 * 1024 * 1024 * 1024)
  pinned.deviceIds = ["cpu0"]
  graph = addMemoryDomain(graph, pinned)

  // sysmem <-> pinned (host-side DMA)
  graph = addTransportEdge(graph,
    createTransportEdge("edge_sysmem_to_pinned", "sysmem", "pinned_host0", "pinned_host_copy"))
  graph = addTransportEdge(graph,
    createTransportEdge("edge_pinned_to_sysmem", "pinned_host0", "sysmem", "pinned_host_copy"))

  for (let i = 0; i < dgpuCount; i++) {
    const gpuId = `dgpu${i}`
    const vramId = `vram${i}`

    const gpu = createDevice(gpuId, "discrete_gpu", "rocm", 24 * 1024 * 1024 * 1024)
    gpu.memoryDomainIds = [vramId]
    gpu.computeCapabilities = ["rocm", "vram_access"]
    gpu.supportedWorkloads = ["prefill", "decode", "embedding", "attention", "mlp", "norm", "classification_head"]
    graph = addDeviceToGraph(graph, gpu)

    const vram = createMemoryDomain(vramId, "discrete_gpu_vram", 24 * 1024 * 1024 * 1024)
    vram.deviceIds = [gpuId]
    graph = addMemoryDomain(graph, vram)

    // pinned -> vram (upload)
    graph = addTransportEdge(graph,
      createTransportEdge(`edge_pinned_to_${vramId}`, "pinned_host0", vramId, "pinned_host_copy"))
    // vram -> pinned (readback)
    graph = addTransportEdge(graph,
      createTransportEdge(`edge_${vramId}_to_pinned`, vramId, "pinned_host0", "backend_device_copy"))
    // sysmem -> vram
    graph = addTransportEdge(graph,
      createTransportEdge(`edge_sysmem_to_${vramId}`, "sysmem", vramId, "pinned_host_copy"))

    // Peer-to-peer edges between VRAM domains
    for (let j = 0; j < i; j++) {
      const peerVramId = `vram${j}`
      graph = addTransportEdge(graph,
        createTransportEdge(`edge_${vramId}_to_${peerVramId}`, vramId, peerVramId, "peer_device_copy"))
      graph = addTransportEdge(graph,
        createTransportEdge(`edge_${peerVramId}_to_${vramId}`, peerVramId, vramId, "peer_device_copy"))
    }
  }

  graph = updateAllEdges(graph, "available")

  return graph
}

// ── Heterogeneous Host ──────────────────────────────────────────────────────

/**
 * Build a topology graph for a fully heterogeneous host.
 *
 * Combines APU (optionally with NPU), discrete GPUs, and Tensix accelerators
 * into a single unified topology graph.
 */
export function probeHeterogeneousHost(
  apuNpu: boolean,
  dgpuCount: number,
  tensixCount: number,
): PrismTopologyGraph {
  let graph = createEmptyTopologyGraph("heterogeneous-host")

  // ── CPU / host memory ──
  const cpu = createDevice("cpu0", "cpu", "cpu_native", 128 * 1024 * 1024 * 1024)
  cpu.memoryDomainIds = ["sysmem", "pinned_host0"]
  cpu.computeCapabilities = ["cpu_native"]
  cpu.supportedWorkloads = ["tokenization", "postprocessing", "norm"]
  graph = addDeviceToGraph(graph, cpu)

  const sysmem = createMemoryDomain("sysmem", "cpu_system_memory", 128 * 1024 * 1024 * 1024)
  sysmem.deviceIds = ["cpu0"]
  graph = addMemoryDomain(graph, sysmem)

  const pinned = createMemoryDomain("pinned_host0", "pinned_host_memory", 8 * 1024 * 1024 * 1024)
  pinned.deviceIds = ["cpu0"]
  graph = addMemoryDomain(graph, pinned)

  // ── APU / iGPU ──
  const igpu = createDevice("igpu0", "integrated_gpu", "rocm", 16 * 1024 * 1024 * 1024)
  igpu.memoryDomainIds = ["apu_shared0"]
  igpu.computeCapabilities = ["rocm", "shared_memory"]
  igpu.supportedWorkloads = ["prefill", "decode", "embedding", "attention", "mlp"]
  graph = addDeviceToGraph(graph, igpu)

  const apuShared = createMemoryDomain("apu_shared0", "apu_shared_memory", 16 * 1024 * 1024 * 1024)
  apuShared.deviceIds = ["cpu0", "igpu0"]
  graph = addMemoryDomain(graph, apuShared)

  graph = addTransportEdge(graph,
    createTransportEdge("edge_sysmem_to_apu_shared", "sysmem", "apu_shared0", "direct_shared_access"))
  graph = addTransportEdge(graph,
    createTransportEdge("edge_apu_shared_to_sysmem", "apu_shared0", "sysmem", "direct_shared_access"))

  // ── (Optional) NPU ──
  if (apuNpu) {
    const npu = createDevice("npu0", "npu", "rocm", 8 * 1024 * 1024 * 1024)
    npu.memoryDomainIds = ["npu_shared0"]
    npu.computeCapabilities = ["rocm", "npu_inference"]
    npu.supportedWorkloads = ["embedding", "norm"]
    graph = addDeviceToGraph(graph, npu)

    const npuMem = createMemoryDomain("npu_shared0", "npu_shared_memory", 8 * 1024 * 1024 * 1024)
    npuMem.deviceIds = ["npu0"]
    graph = addMemoryDomain(graph, npuMem)

    graph = addTransportEdge(graph,
      createTransportEdge("edge_sysmem_to_npu_shared", "sysmem", "npu_shared0", "direct_shared_access"))
    graph = addTransportEdge(graph,
      createTransportEdge("edge_npu_shared_to_sysmem", "npu_shared0", "sysmem", "direct_shared_access"))
  }

  // ── Discrete GPUs ──
  for (let i = 0; i < dgpuCount; i++) {
    const gpuId = `dgpu${i}`
    const vramId = `vram${i}`

    const gpu = createDevice(gpuId, "discrete_gpu", "rocm", 48 * 1024 * 1024 * 1024)
    gpu.memoryDomainIds = [vramId]
    gpu.computeCapabilities = ["rocm", "vram_access"]
    gpu.supportedWorkloads = ["prefill", "decode", "embedding", "attention", "mlp", "norm", "classification_head"]
    graph = addDeviceToGraph(graph, gpu)

    const vram = createMemoryDomain(vramId, "discrete_gpu_vram", 48 * 1024 * 1024 * 1024)
    vram.deviceIds = [gpuId]
    graph = addMemoryDomain(graph, vram)

    graph = addTransportEdge(graph,
      createTransportEdge(`edge_pinned_to_${vramId}`, "pinned_host0", vramId, "pinned_host_copy"))
    graph = addTransportEdge(graph,
      createTransportEdge(`edge_${vramId}_to_pinned`, vramId, "pinned_host0", "backend_device_copy"))
    graph = addTransportEdge(graph,
      createTransportEdge(`edge_sysmem_to_${vramId}`, "sysmem", vramId, "pinned_host_copy"))

    // Peer edges to existing VRAM domains
    for (let j = 0; j < i; j++) {
      const peerVramId = `vram${j}`
      graph = addTransportEdge(graph,
        createTransportEdge(`edge_${vramId}_to_${peerVramId}`, vramId, peerVramId, "peer_device_copy"))
    }
  }

  // ── Tensix Accelerators ──
  for (let i = 0; i < tensixCount; i++) {
    const tensixId = `tensix${i}`
    const dramId = `tensix_dram${i}`

    const tensix = createDevice(tensixId, "accelerator", "tensix", 12 * 1024 * 1024 * 1024)
    tensix.memoryDomainIds = [dramId]
    tensix.computeCapabilities = ["tensix", "device_dram"]
    tensix.supportedWorkloads = ["prefill", "decode", "attention", "mlp"]
    graph = addDeviceToGraph(graph, tensix)

    const dram = createMemoryDomain(dramId, "accelerator_device_dram", 12 * 1024 * 1024 * 1024)
    dram.deviceIds = [tensixId]
    graph = addMemoryDomain(graph, dram)

    graph = addTransportEdge(graph,
      createTransportEdge(`edge_pinned_to_${dramId}`, "pinned_host0", dramId, "pinned_host_copy"))
    graph = addTransportEdge(graph,
      createTransportEdge(`edge_${dramId}_to_pinned`, dramId, "pinned_host0", "backend_device_copy"))
  }

  graph = updateAllEdges(graph, "available")

  return graph
}

// ── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Check whether a topology graph includes an APU (integrated GPU).
 */
export function isApuHost(graph: PrismTopologyGraph): boolean {
  return graph.devices.some((d) => d.deviceClass === "integrated_gpu")
}

/**
 * Check whether a topology graph includes at least one discrete GPU.
 */
export function hasDiscreteGpu(graph: PrismTopologyGraph): boolean {
  return graph.devices.some((d) => d.deviceClass === "discrete_gpu")
}

/**
 * Check whether a topology graph includes an NPU.
 */
export function hasNpu(graph: PrismTopologyGraph): boolean {
  return graph.devices.some((d) => d.deviceClass === "npu")
}

/**
 * Check whether a topology graph includes any accelerator device
 * (GPU, NPU, TPU, FPGA, accelerator — anything beyond CPU).
 */
export function hasAccelerator(graph: PrismTopologyGraph): boolean {
  return graph.devices.some(
    (d) =>
      d.deviceClass !== "cpu" &&
      d.deviceClass !== "virtual",
  )
}

// ── Internal ────────────────────────────────────────────────────────────────

function updateAllEdges(graph: PrismTopologyGraph, state: "available" | "untested"): PrismTopologyGraph {
  return {
    ...graph,
    transportEdges: graph.transportEdges.map((e) => ({ ...e, availabilityState: state })),
  }
}
