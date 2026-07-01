/**
 * Prism Heterogeneous Memory Fabric — Host Topology Probe
 *
 * Real host probe that inspects the machine and produces a PrismTopologyGraph +
 * HostCapabilityDossier.  Uses sysctl (macOS) and process properties for
 * live detection; falls back to known machine characteristics.
 */

import * as os from "node:os"
import * as process from "node:process"

import {
  type PrismTopologyGraph,
  type PrismMemoryDomainInfo,
  type PrismMemoryTransportEdge,
  type PrismComputeDevice,
  type PrismDeviceClass,
  type BackendKind,
} from "./fabric-types"

import { createEmptyTopologyGraph, addDeviceToGraph, addMemoryDomain, addTransportEdge } from "./topology-graph"
import { createDevice } from "./device-registry"
import { createMemoryDomain } from "./memory-domain"
import { createTransportEdge } from "./transport-edge"

// ── Constants ───────────────────────────────────────────────────────────────
// Known Apple Silicon M1 characteristics

const APPLE_SILICON_M1_CPU_CORES = 8 // 4 performance + 4 efficiency
const APPLE_SILICON_M1_GPU_CORES = 7 // base M1; M1 Pro/Max/Ultra differ
const APPLE_SILICON_M1_ANE_CORES = 16
const APPLE_SILICON_M1_UNIFIED_MEM_GB = 16
const APPLE_SILICON_M1_UNIFIED_MEM_BYTES = APPLE_SILICON_M1_UNIFIED_MEM_GB * 1024 * 1024 * 1024
const APPLE_SILICON_M1_PRACTICAL_INFERENCE_BYTES = 12 * 1024 * 1024 * 1024 // ~12 GB usable for inference

// Default for linux CPU hosts
const DEFAULT_LINUX_CPU_MEM_BYTES = 64 * 1024 * 1024 * 1024 // 64 GB
const DEFAULT_UNKNOWN_MEM_BYTES = 8 * 1024 * 1024 * 1024 // 8 GB

// ── HostCapabilityDossier ───────────────────────────────────────────────────

export interface HostCapabilityDossier {
  hostClass: "apple_silicon" | "linux_cpu" | "amd_apu" | "amd_apu_dgpu" | "unknown"
  osVersion: string
  osFamily: string
  arch: string
  backendVersions: Record<string, string>
  cpuDomain: PrismMemoryDomainInfo
  gpuDomain: PrismMemoryDomainInfo | null
  npuDomain: PrismMemoryDomainInfo | null
  deviceMemoryDomains: PrismMemoryDomainInfo[]
  legalTransportEdges: PrismMemoryTransportEdge[]
  measuredBandwidthClasses: string[]
  measuredLatencyClasses: string[]
  supportedArtifactClasses: string[]
  enabledPlacementPolicies: string[]
  disabledPlacementPolicies: string[]
  evidenceTimestamp: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run a command synchronously and return trimmed stdout, or "" on failure.
 * Used for sysctl queries on macOS / procfs on Linux.
 */
function tryExecSync(cmd: string): string {
  try {
    const buf = Bun.spawnSync(cmd.split(" "), {})
    if (buf.exitCode === 0) {
      return buf.stdout.toString().trim()
    }
  } catch {
    // silent fallback
  }
  return ""
}

/**
 * Detect total physical memory bytes using the best available mechanism.
 */
export function detectMemoryBytes(): number {
  // macOS
  const hwMemsize = tryExecSync("sysctl -n hw.memsize")
  if (hwMemsize) {
    const n = Number.parseInt(hwMemsize, 10)
    if (!Number.isNaN(n) && n > 0) return n
  }

  // Linux
  try {
    const buf = Bun.spawnSync(["free", "-b"], {})
    if (buf.exitCode === 0) {
      const lines = buf.stdout.toString().trim().split("\n")
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/)
        if (parts.length >= 2) {
          const n = Number.parseInt(parts[1], 10)
          if (!Number.isNaN(n) && n > 0) return n
        }
      }
    }
  } catch {
    // fall through
  }

  // Fallback: os.totalmem()
  const tm = os.totalmem()
  if (tm > 0) return tm

  // Last resort
  return DEFAULT_UNKNOWN_MEM_BYTES
}

/**
 * Detect OS information from the running environment.
 */
export function detectOsInfo(): { osFamily: string; osVersion: string; arch: string } {
  const osFamily = process.platform === "darwin"
    ? "macos"
    : process.platform === "linux"
      ? "linux"
      : process.platform === "win32"
        ? "windows"
        : process.platform

  let osVersion = ""
  try {
    osVersion = os.release()
  } catch {
    osVersion = "unknown"
  }

  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : process.arch

  return { osFamily, osVersion, arch }
}

/**
 * Detect the host class from the running environment.
 */
export function detectHostClass(): string {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "apple_silicon"
  }
  if (process.platform === "linux") {
    return "linux_cpu"
  }
  return "unknown"
}

/**
 * Detect backend versions from the running environment (Metal, ROCm, etc.).
 */
function detectBackendVersions(): Record<string, string> {
  const versions: Record<string, string> = {}

  // Process versions (Node/Bun runtime)
  versions.node = process.version || "unknown"
  try {
    versions.bun = process.versions?.bun || ""
  } catch {
    // not Bun
  }

  // macOS Metal — try `metal --version` or check macOS version
  if (process.platform === "darwin") {
    const darwinVersion = os.release()
    versions.darwin = darwinVersion
    // macOS 13+ supports Metal 3, macOS 14+ Metal 4
    const major = Number.parseInt(darwinVersion.split(".")[0], 10)
    // Darwin 22 = macOS 13, 23 = macOS 14, 24 = macOS 15, 25 = macOS 16
    if (major >= 25) {
      versions.metal = "4"
    } else if (major >= 24) {
      versions.metal = "4"
    } else if (major >= 23) {
      versions.metal = "3"
    } else if (major >= 22) {
      versions.metal = "3"
    } else {
      versions.metal = "2"
    }
  }

  // Linux — try ROCm version
  if (process.platform === "linux") {
    const rocmVer = tryExecSync("cat /opt/rocm/.info/version")
    if (rocmVer) versions.rocm = rocmVer
    const cudaVer = tryExecSync("nvcc --version | grep release | awk '{print $6}' | tr -d ','")
    if (cudaVer) versions.cuda = cudaVer
  }

  return versions
}

/**
 * Maximum memory bytes for a pool of this kind — used for transport edge maxBytes.
 */
function maxBytesForDomainKind(kind: string, totalBytes: number): number {
  switch (kind) {
    case "cpu_system_memory":
    case "apu_shared_memory":
      return totalBytes
    case "integrated_gpu_local_alias":
      return Math.round(totalBytes * 0.75) // iGPU gets most of shared pool
    case "npu_shared_memory":
      return Math.round(totalBytes * 0.25) // NPU gets smaller carveout
    case "discrete_gpu_vram":
      return totalBytes
    default:
      return totalBytes
  }
}

// ── Probe: Apple Silicon M1 ─────────────────────────────────────────────────

/**
 * Probe the current host as Apple Silicon (M1).
 *
 * Uses sysctl for live processor/memory detection where available, falling
 * back to known M1 characteristics for offline/test scenarios.
 */
export function probeAppleSiliconHost(): HostCapabilityDossier {
  const osInfo = detectOsInfo()
  const totalMemBytes = detectMemoryBytes()
  const practicalMemBytes = Math.min(
    Math.round(totalMemBytes * 0.75),
    APPLE_SILICON_M1_PRACTICAL_INFERENCE_BYTES,
  )
  const aneMemBytes = Math.round(totalMemBytes * 0.1) // ~1.6 GB carveout
  const backendVersions = detectBackendVersions()

  // ── CPU Core Detection (live) ──────────────────────────────────────────
  let perfCores = 4
  let effCores = 4
  const perfCtl = tryExecSync("sysctl -n hw.perflevel0.logicalcpu")
  const effCtl = tryExecSync("sysctl -n hw.perflevel1.logicalcpu")
  if (perfCtl) {
    const n = Number.parseInt(perfCtl, 10)
    if (!Number.isNaN(n) && n > 0) perfCores = n
  }
  if (effCtl) {
    const n = Number.parseInt(effCtl, 10)
    if (!Number.isNaN(n) && n > 0) effCores = n
  }
  const totalCores = perfCores + effCores

  const cpuLabel = `${totalCores}-core (${perfCores}P + ${effCores}E)`

  // ── Memory Domains ────────────────────────────────────────────────────

  const cpuDomain: PrismMemoryDomainInfo = {
    domainId: "sysmem",
    domainKind: "cpu_system_memory",
    deviceIds: ["cpu0", "igpu0"],
    totalBytes: totalMemBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 4096,
  }

  const igpuDomain: PrismMemoryDomainInfo = {
    domainId: "igpu_shared",
    domainKind: "apu_shared_memory",
    deviceIds: ["cpu0", "igpu0"],
    totalBytes: totalMemBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 16384,
  }

  const igpuLocalDomain: PrismMemoryDomainInfo = {
    domainId: "igpu_local",
    domainKind: "integrated_gpu_local_alias",
    deviceIds: ["igpu0"],
    totalBytes: practicalMemBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 16384,
  }

  const aneDomain: PrismMemoryDomainInfo = {
    domainId: "ane_shared",
    domainKind: "npu_shared_memory",
    deviceIds: ["npu0"],
    totalBytes: aneMemBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 16384,
  }

  // ── Transport Edges ───────────────────────────────────────────────────

  const legalTransportEdges: PrismMemoryTransportEdge[] = [
    // CPU <-> System Memory (sysmem)
    createTransportEdge("edge_sysmem_to_sysmem", "sysmem", "sysmem", "direct_shared_access"),
    // System Memory <-> Shared APU Memory (CPU→iGPU direct)
    {
      ...createTransportEdge("edge_sysmem_to_igpu_shared", "sysmem", "igpu_shared", "direct_shared_access"),
      accessMode: "read_write",
      coherencyMode: "coherent",
      maximumBytes: maxBytesForDomainKind("cpu_system_memory", totalMemBytes),
      measuredBandwidthBytesPerSecond: 70_000_000_000, // ~70 GB/s UMA bandwidth
      measuredLatencyMicroseconds: 100,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
    // Shared APU Memory → iGPU Local (zero-copy map)
    {
      ...createTransportEdge("edge_igpu_shared_to_igpu_local", "igpu_shared", "igpu_local", "zero_copy_mapped_access"),
      accessMode: "mapped",
      coherencyMode: "io_coherent",
      maximumBytes: maxBytesForDomainKind("integrated_gpu_local_alias", practicalMemBytes),
      measuredBandwidthBytesPerSecond: 60_000_000_000,
      measuredLatencyMicroseconds: 150,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
    // iGPU Local → Shared APU Memory (GPU writes back)
    {
      ...createTransportEdge("edge_igpu_local_to_igpu_shared", "igpu_local", "igpu_shared", "zero_copy_mapped_access"),
      accessMode: "mapped",
      coherencyMode: "io_coherent",
      maximumBytes: maxBytesForDomainKind("integrated_gpu_local_alias", practicalMemBytes),
      measuredBandwidthBytesPerSecond: 60_000_000_000,
      measuredLatencyMicroseconds: 150,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
    // System Memory → iGPU Local (serialized copy for non-shared paths)
    {
      ...createTransportEdge("edge_sysmem_to_igpu_local", "sysmem", "igpu_local", "serialized_payload_copy"),
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: maxBytesForDomainKind("integrated_gpu_local_alias", practicalMemBytes),
      measuredBandwidthBytesPerSecond: 40_000_000_000,
      measuredLatencyMicroseconds: 500,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "degraded",
    },
    // iGPU Local → System Memory (serialized copy back)
    {
      ...createTransportEdge("edge_igpu_local_to_sysmem", "igpu_local", "sysmem", "serialized_payload_copy"),
      accessMode: "read_write",
      coherencyMode: "non_coherent",
      maximumBytes: maxBytesForDomainKind("cpu_system_memory", totalMemBytes),
      measuredBandwidthBytesPerSecond: 40_000_000_000,
      measuredLatencyMicroseconds: 500,
      supportsAsync: true,
      supportsCancellation: true,
      supportsIntegrityValidation: true,
      availabilityState: "degraded",
    },
    // System Memory <-> NPU Shared Memory
    {
      ...createTransportEdge("edge_sysmem_to_ane_shared", "sysmem", "ane_shared", "direct_shared_access"),
      accessMode: "read_write",
      coherencyMode: "io_coherent",
      maximumBytes: maxBytesForDomainKind("npu_shared_memory", aneMemBytes),
      measuredBandwidthBytesPerSecond: 20_000_000_000,
      measuredLatencyMicroseconds: 300,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
    // NPU Shared → System Memory
    {
      ...createTransportEdge("edge_ane_shared_to_sysmem", "ane_shared", "sysmem", "direct_shared_access"),
      accessMode: "read_write",
      coherencyMode: "io_coherent",
      maximumBytes: maxBytesForDomainKind("cpu_system_memory", totalMemBytes),
      measuredBandwidthBytesPerSecond: 20_000_000_000,
      measuredLatencyMicroseconds: 300,
      supportsAsync: true,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
  ]

  const supportedArtifactClasses = [
    "gguf_q4_0",
    "gguf_q4_1",
    "gguf_q5_0",
    "gguf_q5_1",
    "gguf_q8_0",
    "gguf_f16",
    "mlx_q4",
    "mlx_q8",
    "coreml_fp16",
  ]

  const enabledPlacementPolicies = [
    "apu_cpu_only",
    "apu_integrated_gpu",
    "apu_npu_subgraph",
    "apu_shared_cpu_gpu_pipeline",
    "fallback_cpu",
  ]

  const disabledPlacementPolicies = [
    "dGPU_offload",
    "dGPU_resident_session",
    "mixed_apu_dGPU_pipeline",
    "accelerator_device_execution",
  ]

  // ── Known Bandwidth / Latency Classes ────────────────────────────────

  const measuredBandwidthClasses = [
    "ultra_high",   // >100 GB/s (L1/L2 cache-domain)
    "very_high",    // 50-100 GB/s (UMA)
    "high",         // 25-50 GB/s (copy paths)
    "medium",       // 10-25 GB/s (NPU paths)
  ]

  const measuredLatencyClasses = [
    "ultra_low",    // <0.5 µs (L1 cache)
    "low",          // 0.5-5 µs (L2)
    "medium",       // 5-50 µs (UMA access)
    "high",         // 50-500 µs (copy paths)
  ]

  return {
    hostClass: "apple_silicon",
    osVersion: osInfo.osVersion,
    osFamily: osInfo.osFamily,
    arch: osInfo.arch,
    backendVersions,
    cpuDomain,
    gpuDomain: igpuDomain,
    npuDomain: aneDomain,
    deviceMemoryDomains: [igpuDomain, igpuLocalDomain, aneDomain],
    legalTransportEdges,
    measuredBandwidthClasses,
    measuredLatencyClasses,
    supportedArtifactClasses,
    enabledPlacementPolicies,
    disabledPlacementPolicies,
    evidenceTimestamp: new Date().toISOString(),
  }
}

// ── Probe: Linux CPU ────────────────────────────────────────────────────────

/**
 * Probe a Linux CPU-only host (no GPU/NPU acceleration).
 */
export function probeLinuxCpuHost(): HostCapabilityDossier {
  const osInfo = detectOsInfo()
  const totalMemBytes = detectMemoryBytes()
  const backendVersions = detectBackendVersions()

  const cpuDomain: PrismMemoryDomainInfo = {
    domainId: "sysmem",
    domainKind: "cpu_system_memory",
    deviceIds: ["cpu0"],
    totalBytes: totalMemBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 4096,
  }

  const legalTransportEdges: PrismMemoryTransportEdge[] = [
    {
      ...createTransportEdge("edge_sysmem_to_sysmem", "sysmem", "sysmem", "direct_shared_access"),
      accessMode: "read_write",
      coherencyMode: "coherent",
      maximumBytes: totalMemBytes,
      measuredBandwidthBytesPerSecond: null,
      measuredLatencyMicroseconds: null,
      supportsAsync: false,
      supportsCancellation: false,
      supportsIntegrityValidation: false,
      availabilityState: "available",
    },
  ]

  const supportedArtifactClasses = ["gguf_q8_0", "gguf_f16"]
  const enabledPlacementPolicies = ["fallback_cpu"]
  const disabledPlacementPolicies = [
    "apu_cpu_only",
    "apu_integrated_gpu",
    "apu_npu_subgraph",
    "apu_shared_cpu_gpu_pipeline",
    "dGPU_offload",
    "dGPU_resident_session",
    "mixed_apu_dGPU_pipeline",
    "accelerator_device_execution",
  ]

  return {
    hostClass: "linux_cpu",
    osVersion: osInfo.osVersion,
    osFamily: osInfo.osFamily,
    arch: osInfo.arch,
    backendVersions,
    cpuDomain,
    gpuDomain: null,
    npuDomain: null,
    deviceMemoryDomains: [],
    legalTransportEdges,
    measuredBandwidthClasses: ["medium"],
    measuredLatencyClasses: ["high"],
    supportedArtifactClasses,
    enabledPlacementPolicies,
    disabledPlacementPolicies,
    evidenceTimestamp: new Date().toISOString(),
  }
}

// ── Probe: Unknown Host ─────────────────────────────────────────────────────

/**
 * Probe an unknown/completely unrecognized host type.
 */
export function probeUnknownHost(): HostCapabilityDossier {
  const osInfo = detectOsInfo()
  const totalMemBytes = detectMemoryBytes()

  const cpuDomain: PrismMemoryDomainInfo = {
    domainId: "sysmem",
    domainKind: "cpu_system_memory",
    deviceIds: ["cpu0"],
    totalBytes: totalMemBytes,
    usedBytes: 0,
    reservedBytes: 0,
    allocationGranularity: 4096,
  }

  return {
    hostClass: "unknown",
    osVersion: osInfo.osVersion,
    osFamily: osInfo.osFamily,
    arch: osInfo.arch,
    backendVersions: {},
    cpuDomain,
    gpuDomain: null,
    npuDomain: null,
    deviceMemoryDomains: [],
    legalTransportEdges: [],
    measuredBandwidthClasses: [],
    measuredLatencyClasses: [],
    supportedArtifactClasses: [],
    enabledPlacementPolicies: [],
    disabledPlacementPolicies: [],
    evidenceTimestamp: new Date().toISOString(),
  }
}

// ── Probe: Current Host ─────────────────────────────────────────────────────

/**
 * Detect and probe the current host, producing a real capability dossier.
 *
 * - macOS arm64 → probeAppleSiliconHost()
 * - Other        → probeLinuxCpuHost()
 */
export async function probeCurrentHost(): Promise<HostCapabilityDossier> {
  const hostClass = detectHostClass()
  switch (hostClass) {
    case "apple_silicon":
      return probeAppleSiliconHost()
    case "linux_cpu":
      return probeLinuxCpuHost()
    default:
      return probeUnknownHost()
  }
}

// ── Dossier → Topology Graph ────────────────────────────────────────────────

/**
 * Convert a HostCapabilityDossier into a PrismTopologyGraph suitable for
 * the Prism fabric placement engine.
 */
export function dossierToTopologyGraph(dossier: HostCapabilityDossier): PrismTopologyGraph {
  let graph = createEmptyTopologyGraph(`host-${dossier.hostClass}-${dossier.arch}`)

  // ── CPU Device ───────────────────────────────────────────────────────
  const cpuBackend: BackendKind = dossier.hostClass === "apple_silicon"
    ? "metal"
    : "cpu_native"

  const cpuMemBytes = dossier.cpuDomain.totalBytes

  const cpu = createDevice("cpu0", "cpu", cpuBackend, cpuMemBytes)
  const cpuDomainIds = [dossier.cpuDomain.domainId]

  // Attach GPU domain if present (shared memory for Apple Silicon)
  if (dossier.gpuDomain) {
    cpuDomainIds.push(dossier.gpuDomain.domainId)
  }

  cpu.memoryDomainIds = cpuDomainIds
  cpu.computeCapabilities = cpuBackend === "metal" ? ["metal", "cpu_native", "ane_inference"] : ["cpu_native"]
  cpu.supportedWorkloads = ["tokenization", "postprocessing", "norm"]
  graph = addDeviceToGraph(graph, cpu)

  // Ensure the CPU domain exists in the graph
  graph = addMemoryDomain(graph, { ...dossier.cpuDomain, usedBytes: 0, reservedBytes: 0 })

  // ── GPU Device ───────────────────────────────────────────────────────
  if (dossier.gpuDomain) {
    const gpu = createDevice("igpu0", "integrated_gpu", "metal", dossier.gpuDomain.totalBytes)
    gpu.memoryDomainIds = [dossier.gpuDomain.domainId]

    // iGPU local alias domain exists in the dossier's deviceMemoryDomains
    const localAlias = dossier.deviceMemoryDomains.find(
      (d) => d.domainKind === "integrated_gpu_local_alias",
    )
    if (localAlias) {
      gpu.memoryDomainIds.push(localAlias.domainId)
    }

    gpu.computeCapabilities = ["metal", "shared_memory", "unified_memory"]
    gpu.supportedWorkloads = ["prefill", "decode", "embedding", "attention", "mlp", "norm"]
    graph = addDeviceToGraph(graph, gpu)

    // Add shared memory domain
    graph = addMemoryDomain(graph, {
      ...dossier.gpuDomain,
      usedBytes: 0,
      reservedBytes: 0,
    })

    // Add iGPU local alias domain
    if (localAlias) {
      graph = addMemoryDomain(graph, {
        ...localAlias,
        usedBytes: 0,
        reservedBytes: 0,
      })
    }
  }

  // ── NPU Device ───────────────────────────────────────────────────────
  if (dossier.npuDomain) {
    const npu = createDevice("npu0", "npu", "metal", dossier.npuDomain.totalBytes)
    npu.memoryDomainIds = [dossier.npuDomain.domainId]
    npu.computeCapabilities = ["metal", "ane_inference", "npu_inference"]
    npu.supportedWorkloads = ["embedding", "norm", "attention"]
    graph = addDeviceToGraph(graph, npu)

    graph = addMemoryDomain(graph, {
      ...dossier.npuDomain,
      usedBytes: 0,
      reservedBytes: 0,
    })
  }

  // ── Additional Device Memory Domains ──────────────────────────────────
  // Add any domains not already added (e.g. discrete GPU vram domains)
  const addedDomainIds = new Set(graph.memoryDomains.map((d) => d.domainId))
  for (const d of dossier.deviceMemoryDomains) {
    if (!addedDomainIds.has(d.domainId)) {
      graph = addMemoryDomain(graph, { ...d, usedBytes: 0, reservedBytes: 0 })
    }
  }

  // ── Transport Edges ──────────────────────────────────────────────────
  for (const edge of dossier.legalTransportEdges) {
    graph = addTransportEdge(graph, edge)
  }

  // ── Capabilities & Bandwidth / Latency Classes ───────────────────────

  graph.capabilitySignatures = [...dossier.supportedArtifactClasses]

  graph.policyRestrictions = [
    ...dossier.disabledPlacementPolicies.map((p) => `disabled:${p}`),
  ]

  graph.measuredBandwidthClasses = dossier.measuredBandwidthClasses.map((name) => {
    // Map human-readable class names to threshold objects
    switch (name) {
      case "ultra_high":
        return { className: "ultra_high", minimumBytesPerSecond: 100_000_000_000, maximumBytesPerSecond: Infinity }
      case "very_high":
        return { className: "very_high", minimumBytesPerSecond: 50_000_000_000, maximumBytesPerSecond: 100_000_000_000 }
      case "high":
        return { className: "high", minimumBytesPerSecond: 25_000_000_000, maximumBytesPerSecond: 50_000_000_000 }
      case "medium":
        return { className: "medium", minimumBytesPerSecond: 10_000_000_000, maximumBytesPerSecond: 25_000_000_000 }
      case "low":
        return { className: "low", minimumBytesPerSecond: 1_000_000_000, maximumBytesPerSecond: 10_000_000_000 }
      default:
        return { className: name, minimumBytesPerSecond: 0, maximumBytesPerSecond: Infinity }
    }
  })

  graph.measuredLatencyClasses = dossier.measuredLatencyClasses.map((name) => {
    switch (name) {
      case "ultra_low":
        return { className: "ultra_low", minimumMicroseconds: 0, maximumMicroseconds: 0.5 }
      case "low":
        return { className: "low", minimumMicroseconds: 0.5, maximumMicroseconds: 5 }
      case "medium":
        return { className: "medium", minimumMicroseconds: 5, maximumMicroseconds: 50 }
      case "high":
        return { className: "high", minimumMicroseconds: 50, maximumMicroseconds: 500 }
      case "slow":
        return { className: "slow", minimumMicroseconds: 500, maximumMicroseconds: Infinity }
      default:
        return { className: name, minimumMicroseconds: 0, maximumMicroseconds: Infinity }
    }
  })

  return graph
}
