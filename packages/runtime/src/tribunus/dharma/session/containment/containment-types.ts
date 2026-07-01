/**
 * Dharma OS-Enforced Sandbox — Containment Types
 *
 * Core types for the ContainedProcessLauncher, policy compilation,
 * execution receipts, and cross-platform containment backends.
 */

// ── Containment Backend Identification --------------------------------------

export type ContainmentBackendKind =
  | "macos_seatbelt"
  | "macos_app_sandbox"
  | "linux_namespaces"
  | "none"

// ── Network Policy -----------------------------------------------------------

export type NetworkPolicyMode = "none" | "loopback_only" | "allowlisted"

export interface NetworkPolicy {
  mode: NetworkPolicyMode
  allowedDomains: string[]
  allowedPorts: number[]
}

// ── Filesystem Policy --------------------------------------------------------

export interface FilesystemPolicy {
  readableRoots: string[]
  writableRoots: string[]
  deniedRoots: string[]
  allowExecutable: string
  allowWorkingDirectory: string | null
  allowSymlinkEscape: boolean
  requirePathResolution: boolean
}

// ── Environment Policy -------------------------------------------------------

export interface EnvironmentPolicy {
  allowedVariables: string[]
  deniedVariables: string[]
  staticValues: Record<string, string>
  sandboxHome: string
  sandboxTemp: string
}

// ── Resource Limits ----------------------------------------------------------

export interface ResourceLimits {
  maximumRuntimeSeconds: number
  maximumCpuSeconds: number
  maximumMemoryBytes: number
  maximumProcessCount: number
  maximumOpenFiles: number
  maximumDiskWriteBytes: number
  maximumOutputBytes: number
  maximumTempBytes: number
  maximumNetworkBytes: number
}

// ── Process Policy -----------------------------------------------------------

export interface ProcessPolicy {
  allowPtrace: boolean
  allowSignalingUnrelated: boolean
  allowIpc: boolean
  allowThreadCreation: boolean
  allowChildProcesses: boolean
  maximumChildDepth: number
}

// ── IPC Policy ---------------------------------------------------------------

export interface IpcPolicy {
  allowUnixSockets: boolean
  allowSharedMemory: boolean
  allowMessageQueues: boolean
  allowNamedPipes: boolean
  allowDesktopIpc: boolean
  allowedSocketPaths: string[]
}

// ── ContainedExecutionRequest ------------------------------------------------

export interface ContainedExecutionRequest {
  executionId: string
  sessionId: string
  membershipId: string
  grantId: string
  sandboxRoot: string
  canonicalWorkspaceRoot: string
  overlayRoot: string | null
  readableRoots: string[]
  writableRoots: string[]
  executablePath: string
  argv: string[]
  workingDirectory: string | null
  networkPolicy: NetworkPolicy
  environmentPolicy: EnvironmentPolicy
  resourceLimits: ResourceLimits
  ipcPolicy: IpcPolicy
  processPolicy: ProcessPolicy
  issuedAt: string
}

// ── ContainedExecutionReceipt -----------------------------------------------

export interface ContainmentViolationEvent {
  timestamp: string
  kind: string
  details: string
}

export interface ContainedExecutionReceipt {
  executionId: string
  containmentBackend: ContainmentBackendKind
  containmentProfileDigest: string
  filesystemPolicyDigest: string
  networkPolicyDigest: string
  resourcePolicyDigest: string
  startedAt: string
  endedAt: string
  exitCode: number | null
  terminationReason: string | null
  violationEvents: ContainmentViolationEvent[]
  stdoutDigest: string | null
  stderrDigest: string | null
  processTreeSummary: string
}

// ── Containment Profile ------------------------------------------------------

export interface ContainmentProfile {
  profileId: string
  backendKind: ContainmentBackendKind
  filesystemPolicy: FilesystemPolicy
  networkPolicy: NetworkPolicy
  environmentPolicy: EnvironmentPolicy
  resourceLimits: ResourceLimits
  ipcPolicy: IpcPolicy
  processPolicy: ProcessPolicy
  profileDigest: string
  createdAt: string
}

// ── Process Tree -------------------------------------------------------------

export interface ContainedProcessTree {
  executionId: string
  rootPid: number | null
  containmentId: string
  processGroupId: string
  startedAt: string
  childCount: number
  state: ProcessTreeState
  leafPids: number[]
}

export type ProcessTreeState = "running" | "draining" | "terminated" | "orphaned"

// ── Capability Detection ----------------------------------------------------

export interface ContainmentCapability {
  backend: ContainmentBackendKind
  available: boolean
  version: string | null
  supportedFeatures: string[]
  unsupportedFeatures: string[]
  deprecationWarning: string | null
}

// ── Violation Record --------------------------------------------------------

export interface ContainmentViolation {
  violationId: string
  executionId: string
  sessionId: string
  timestamp: string
  kind: ViolationKind
  severity: ViolationSeverity
  details: string
}

export type ViolationKind =
  | "filesystem_escape"
  | "network_access"
  | "secret_access"
  | "process_spawn"
  | "ipc_access"
  | "process_signal"
  | "resource_exceeded"
  | "syscall_denied"
  | "mount_attempt"

export type ViolationSeverity = "info" | "warning" | "critical"
