/**
 * Prism Heterogeneous Memory Fabric — Types
 */

// ── Memory Domain Taxonomy --------------------------------------------------

export type PrismMemoryDomainKind =
  | "cpu_system_memory"
  | "apu_shared_memory"
  | "integrated_gpu_local_alias"
  | "npu_shared_memory"
  | "discrete_gpu_vram"
  | "accelerator_device_dram"
  | "pinned_host_memory"
  | "managed_memory"
  | "shared_memory_segment"
  | "durable_local_cache"

// ── Transport Kinds ---------------------------------------------------------

export type PrismMemoryTransportKind =
  | "direct_shared_access"
  | "zero_copy_mapped_access"
  | "managed_memory_migration"
  | "pinned_host_copy"
  | "backend_device_copy"
  | "peer_device_copy"
  | "dma_buf_import"
  | "local_host_shared_memory_copy"
  | "serialized_payload_copy"
  | "unsupported"

// ── Transport Access Mode ---------------------------------------------------

export type TransportAccessMode = "read_write" | "read_only" | "write_only" | "mapped"

export type TransportCoherencyMode = "coherent" | "io_coherent" | "non_coherent" | "managed"

// ── Transport Edge Availability ---------------------------------------------

export type TransportEdgeState = "available" | "degraded" | "unavailable" | "untested"

// ── PrismMemoryTransportEdge -------------------------------------------------

export interface PrismMemoryTransportEdge {
  edgeId: string
  sourceDomainId: string
  destinationDomainId: string
  transportKind: PrismMemoryTransportKind
  accessMode: TransportAccessMode
  coherencyMode: TransportCoherencyMode
  maximumBytes: number
  measuredBandwidthBytesPerSecond: number | null
  measuredLatencyMicroseconds: number | null
  supportsAsync: boolean
  supportsCancellation: boolean
  supportsIntegrityValidation: boolean
  availabilityState: TransportEdgeState
}

// ── Device Classes ----------------------------------------------------------

export type PrismDeviceClass =
  | "cpu" | "integrated_gpu" | "discrete_gpu" | "npu" | "accelerator" | "tpu" | "fpga" | "virtual"

export type BackendKind =
  | "cpu_native" | "rocm" | "metal" | "cuda" | "vulkan" | "tensix" | "webgpu"

export type WorkloadClass =
  | "prefill" | "decode" | "embedding" | "attention" | "mlp" | "norm"
  | "classification_head" | "vision_encoder" | "audio_feature"
  | "tokenization" | "postprocessing" | "static_subgraph"

export type DeviceHealthState = "healthy" | "degraded" | "unhealthy" | "unreachable"

// ── PrismComputeDevice ------------------------------------------------------

export interface PrismComputeDevice {
  deviceId: string
  deviceClass: PrismDeviceClass
  backendKind: BackendKind
  targetCapabilitySignature: string
  memoryDomainIds: string[]
  computeCapabilities: string[]
  supportedWorkloads: WorkloadClass[]
  availableMemoryBytes: number
  reservedMemoryBytes: number
  healthState: DeviceHealthState
}

// ── Interconnect ------------------------------------------------------------

export type InterconnectType = "pcie" | "p2p" | "fabric" | "numa" | "socket" | "chiplet"

export interface PrismInterconnect {
  interconnectId: string
  sourceDeviceId: string
  destinationDeviceId: string
  interconnectType: InterconnectType
  bandwidthBytesPerSecond: number | null
  latencyMicroseconds: number | null
  hops: number | null
}

// ── Topology Graph ----------------------------------------------------------

export interface PrismTopologyGraph {
  hostInstanceId: string
  topologyGeneration: number
  discoveredAt: string
  devices: PrismComputeDevice[]
  memoryDomains: PrismMemoryDomainInfo[]
  transportEdges: PrismMemoryTransportEdge[]
  interconnects: PrismInterconnect[]
  capabilitySignatures: string[]
  measuredBandwidthClasses: BandwidthClass[]
  measuredLatencyClasses: LatencyClass[]
  policyRestrictions: string[]
}

export interface BandwidthClass {
  className: string
  minimumBytesPerSecond: number
  maximumBytesPerSecond: number
}

export interface LatencyClass {
  className: string
  minimumMicroseconds: number
  maximumMicroseconds: number
}

// ── Memory Domain Info ------------------------------------------------------

export interface PrismMemoryDomainInfo {
  domainId: string
  domainKind: PrismMemoryDomainKind
  deviceIds: string[]
  totalBytes: number
  usedBytes: number
  reservedBytes: number
  allocationGranularity: number
}

// ── Topology Probe ----------------------------------------------------------

export interface PrismTopologyProbe {
  probeHost(): PrismTopologyGraph
  enumerateCpuDomains(): PrismMemoryDomainInfo[]
  enumerateIntegratedGpuDomains(): PrismMemoryDomainInfo[]
  enumerateNpuDomains(): PrismMemoryDomainInfo[]
  enumerateDiscreteGpuDomains(): PrismMemoryDomainInfo[]
  enumerateAcceleratorDomains(): PrismMemoryDomainInfo[]
  inspectInterconnects(): PrismInterconnect[]
  inspectMemoryCapabilities(): Record<string, string[]>
  benchmarkMinimalTransfers(): Partial<PrismMemoryTransportEdge>[]
  buildCapabilityGraph(): PrismTopologyGraph
}

// ── APU Profile -------------------------------------------------------------

export interface PrismApuSharedMemoryProfile {
  profileId: string
  cpuDeviceId: string
  integratedGpuDeviceId: string
  npuDeviceId: string | null
  sharedMemoryDomainId: string
  supportsCpuGpuDirectSharedAccess: boolean
  supportsZeroCopyMappedAccess: boolean
  supportsManagedMemory: boolean
  supportsNpuSharedAccess: boolean
  maximumSharedAllocationBytes: number
  allocationGranularity: number
  coherencyRequirements: string[]
  synchronizationRequirements: string[]
  bandwidthClass: string
  latencyClass: string
}

// ── Placement Request / Response --------------------------------------------

export type WorkloadPhase = "prefill" | "decode" | "mixed"
export type PromptLengthClass = "short" | "medium" | "long" | "very_long"
export type GenerationLengthClass = "short" | "medium" | "long"
export type LatencyPreference = "lowest" | "low" | "standard" | "throughput"
export type EnergyPreference = "balanced" | "low_power" | "performance"

export interface PrismFabricPlacementRequest {
  requestId: string
  routeId: string
  dharmaLeaseId: string | null
  workloadClass: WorkloadClass
  modelArtifactDigest: string
  tokenizerDigest: string
  phase: WorkloadPhase
  inputTokenCount: number
  requestedOutputTokens: number
  promptLengthClass: PromptLengthClass
  generationLengthClass: GenerationLengthClass
  latencyPreference: LatencyPreference
  energyPreference: EnergyPreference | null
  dataResidencyRequirements: string[]
  allowedDevices: string[]
  forbiddenDevices: string[]
}

export interface PrismFabricPlacementDecision {
  decisionId: string
  selectedDeviceId: string
  selectedMemoryDomainId: string
  selectedTransportPath: PrismMemoryTransportEdge[]
  sourceResidency: PrismMemoryDomainKind | null
  destinationResidency: PrismMemoryDomainKind
  estimatedTransferCost: number
  estimatedExecutionCost: number
  expectedKvReuse: boolean
  fallbackDecisionIds: string[]
  policyBasis: string
  decisionReason: string
}

// ── Placement Modes ---------------------------------------------------------

export type PrismFabricPlacementMode =
  | "apu_cpu_only"
  | "apu_integrated_gpu"
  | "apu_npu_subgraph"
  | "apu_shared_cpu_gpu_pipeline"
  | "dGPU_offload"
  | "dGPU_resident_session"
  | "mixed_apu_dGPU_pipeline"
  | "accelerator_device_execution"
  | "fallback_cpu"

// ── KV Residency Policy -----------------------------------------------------

export interface PrismKvResidencyPolicy {
  preferExistingLocality: boolean
  allowApuSharedResidency: boolean
  allowDgpuResidency: boolean
  allowExportToStaging: boolean
  allowLocalHostHandoff: boolean
  allowBackendNativeImport: boolean
  maximumStagingBytes: number
  retentionDurationMs: number
  migrationThreshold: number
}

// ── Fabric Handoff Request --------------------------------------------------

export interface PrismFabricKvHandoffRequest {
  handoffId: string
  sourceDeviceId: string
  sourceMemoryDomainId: string
  destinationDeviceId: string
  destinationMemoryDomainId: string
  sourceResidencyKind: PrismMemoryDomainKind
  destinationResidencyKind: PrismMemoryDomainKind
  selectedTransportPath: PrismMemoryTransportEdge[]
  transferRepresentation: string
  sourceComputeImageDigest: string
  destinationComputeImageDigest: string
  compatibilityDescriptorDigest: string
  estimatedTransferBytes: number
  policyBasis: string
}

// ── Fabric Memory Budget ----------------------------------------------------

export interface PrismFabricMemoryBudget {
  apuSharedMemoryLimit: number
  apuCpuReserve: number
  apuIntegratedGpuReserve: number
  apuNpuReserve: number | null
  pinnedHostStagingLimit: number
  dGpuVramLimits: Record<string, number>
  acceleratorDramLimits: Record<string, number>
  maximumInflightTransfers: number
  maximumInflightHandoffs: number
  emergencyReclaimThreshold: number
}

// ── Fabric Execution Receipt ------------------------------------------------

export interface PrismFabricExecutionReceipt {
  receiptId: string
  requestId: string
  routeId: string
  dharmaLeaseId: string | null
  sessionId: string | null
  selectedDeviceId: string
  selectedMemoryDomainId: string
  workloadPhase: WorkloadPhase
  placementMode: PrismFabricPlacementMode
  sourceMemoryDomainId: string | null
  destinationMemoryDomainId: string | null
  transportPath: PrismMemoryTransportEdge[]
  transferRepresentation: string | null
  transferredByteCount: number | null
  transferDurationMs: number | null
  modelArtifactDigest: string
  computeImageDigest: string
  targetCapabilitySignature: string
  kvNamespaceDigest: string | null
  kvResidencyBefore: PrismMemoryDomainKind | null
  kvResidencyAfter: PrismMemoryDomainKind | null
  cacheStatus: string | null
  executionDurationMs: number
  peakSourceMemoryBytes: number | null
  peakDestinationMemoryBytes: number | null
  finalState: string
  failureClass: string | null
  emittedAt: string
  signature: string
}

// ── NPU Admission Policy ----------------------------------------------------

export interface PrismNpuAdmissionPolicy {
  backendAvailable: boolean
  supportedOperatorClasses: string[]
  supportedTensorLayouts: string[]
  supportedPrecisionModes: string[]
  sharedMemoryAccessMode: string
  maximumTensorBytes: number
  maximumExecutionDurationMs: number
  supportsCancellation: boolean
  supportsReceipts: boolean
  supportsDharmaCorrelation: boolean
}

// ── Benchmark Schema --------------------------------------------------------

export interface PrismFabricBenchmarkRecord {
  hardwareProfile: string
  driverVersion: string
  runtimeVersion: string
  backendVersion: string
  artifactClass: string
  payloadSize: number
  promptLengthClass: string
  outputLengthClass: string
  sourceDomain: PrismMemoryDomainKind
  destinationDomain: PrismMemoryDomainKind
  transportPath: PrismMemoryTransportKind
  transferBytes: number
  transferLatencyMs: number
  effectiveBandwidthBytesPerSecond: number
  prefillLatencyMs: number | null
  decodeLatencyMs: number | null
  tokenThroughput: number | null
  peakMemoryBytes: number | null
  failureBehavior: string | null
}

// ── Fabric Adapter Interface ------------------------------------------------

export interface PrismMemoryFabricAdapter {
  probeTopology(): Promise<PrismTopologyGraph>
  listMemoryDomains(): PrismMemoryDomainInfo[]
  listTransportEdges(): PrismMemoryTransportEdge[]
  allocate(domainId: string, bytes: number): Promise<string>
  mapShared(domainId: string, allocationId: string): Promise<boolean>
  stageForTransfer(allocationId: string, destinationDomainId: string): Promise<boolean>
  transfer(sourceAllocationId: string, destinationDomainId: string, plan: string): Promise<number>
  synchronize(transferId: string): Promise<boolean>
  release(allocationId: string): Promise<boolean>
  measurePath(edge: PrismMemoryTransportEdge): Promise<Partial<PrismMemoryTransportEdge>>
}

// ── Dharma Fabric Policy ----------------------------------------------------

export interface DharmaPrismFabricPolicy {
  allowedDeviceClasses: PrismDeviceClass[]
  forbiddenDeviceClasses: PrismDeviceClass[]
  allowApuSharedMemory: boolean
  allowDgpuOffload: boolean
  allowManagedMemoryMigration: boolean
  allowDmaBufImport: boolean
  allowLocalHostKvTransport: boolean
  allowNpuSubgraphs: boolean
  maximumTransferBytes: number
  maximumTransferDurationMs: number
  requireResidencyReceipt: boolean
  requireSameHostAuthorityDomain: boolean
}

// ── Fabric Metrics Names ----------------------------------------------------

export const FABRIC_METRICS = [
  "prism_fabric_topology_devices",
  "prism_fabric_memory_domains",
  "prism_fabric_transport_edges",
  "prism_fabric_placement_decisions_total",
  "prism_fabric_placement_fallbacks_total",
  "prism_fabric_apu_shared_memory_bytes",
  "prism_fabric_apu_shared_memory_pressure",
  "prism_fabric_pinned_host_memory_bytes",
  "prism_fabric_dgpu_vram_bytes",
  "prism_fabric_dgpu_vram_pressure",
  "prism_fabric_transfers_total",
  "prism_fabric_transfer_bytes",
  "prism_fabric_transfer_duration_seconds",
  "prism_fabric_transfer_failures_total",
  "prism_fabric_transport_path_total",
  "prism_fabric_kv_residency_total",
  "prism_fabric_kv_migrations_total",
  "prism_fabric_kv_staging_rejections_total",
  "prism_fabric_npu_admissions_total",
  "prism_fabric_npu_rejections_total",
] as const
