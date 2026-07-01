/**
 * Dharma OS-Enforced Sandbox — Barrel
 *
 * Re-exports all public APIs from the containment module.
 */

// Types
export type {
  ContainmentBackendKind,
  NetworkPolicyMode,
  NetworkPolicy,
  FilesystemPolicy,
  EnvironmentPolicy,
  ResourceLimits,
  ProcessPolicy,
  IpcPolicy,
  ContainedExecutionRequest,
  ContainmentViolationEvent,
  ContainedExecutionReceipt,
  ContainmentProfile,
  ContainedProcessTree,
  ProcessTreeState,
  ContainmentCapability,
  ContainmentViolation,
  ViolationKind,
  ViolationSeverity,
} from "./containment-types"

// Errors
export {
  ContainmentError,
  FilesystemEscapeError,
  NetworkDeniedError,
  SecretExposureError,
  ResourceLimitExceededError,
  ProcessSpawnDeniedError,
  IpcDeniedError,
  BackendUnavailableError,
  TerminationError,
  CapabilityDetectionError,
} from "./containment-errors"

// Policy
export {
  computePolicyDigest,
  compileFilesystemPolicy,
  compileNetworkPolicy,
  compileEnvironmentPolicy,
  compileResourceLimits,
  compileIpcPolicy,
  compileProcessPolicy,
  compileContainmentProfile,
  backendCanSatisfy,
  getDefaultResourceLimits,
} from "./containment-policy"

// Audit
export {
  createViolation,
  classifyViolationSeverity,
  formatViolationSummary,
  isEmergencyViolation,
} from "./containment-audit"

// Launcher
export type { ContainmentLauncherConfig } from "./containment-launcher"
export { ContainedProcessLauncher } from "./containment-launcher"

// Probe
export {
  detectCapabilities,
  getContainmentPlatform,
  detectMacOSCapabilities,
  hasSandboxExec,
  detectLinuxCapabilities,
  hasUnshare,
  hasLandlock,
} from "./containment-probe"

// Recovery
export type { ContainmentRecoveryState } from "./containment-recovery"
export {
  createRecoveryState,
  canRecover,
  requiresSessionTermination,
} from "./containment-recovery"

// macOS Backend
export { MacOSSeatbeltCompatibilityBackend } from "./macos/macos-seatbelt-backend"

// macOS Profile
export type { SeatbeltProfile } from "./macos/macos-seatbelt-profile"
export {
  generateSeatbeltProfile,
  generateFileReadRules,
  generateFileWriteRules,
  generateNetworkRules,
  generateDenyRules,
  generateEnvironmentRules,
  computeProfileDigest,
  getSystemRequiredPaths,
} from "./macos/macos-seatbelt-profile"

// macOS Process Tree
export { MacOSProcessTree } from "./macos/macos-process-tree"

// Linux Backend
export { LinuxNamespaceBackend } from "./linux/linux-backend"

// Linux Namespaces
export { LINUX_REQUIRED_NAMESPACES } from "./linux/linux-namespaces"
export {
  checkUserNamespaces,
  getNamespaceFlags,
  hasUnshareBinary,
} from "./linux/linux-namespaces"

// Linux Mounts
export type { MountConfig } from "./linux/linux-mounts"
export {
  buildMountCommands,
  hasMountNamespaceSupport,
} from "./linux/linux-mounts"

// Linux Network Namespace
export {
  buildNetworkIsolationCommand,
  hasNetworkNamespaceSupport,
} from "./linux/linux-network-namespace"

// Linux Seccomp
export type { SeccompFilter } from "./linux/linux-seccomp"
export {
  buildSeccompFilter,
  getAllowedSyscalls,
  getDeniedSyscalls,
  hasSeccompSupport,
} from "./linux/linux-seccomp"

// Linux Landlock
export type { LandlockRules } from "./linux/linux-landlock"
export {
  buildLandlockRules,
  getLandlockABIVersion,
} from "./linux/linux-landlock"

// Linux Cgroups
export type { CgroupConfig } from "./linux/linux-cgroups"
export {
  buildCgroupConfig,
  hasCgroupsV2,
  getCgroupPath,
} from "./linux/linux-cgroups"

// Linux Process Tree
export { LinuxProcessTree } from "./linux/linux-process-tree"

// Schema
export {
  DharmaContainmentInstanceTable,
  DharmaContainmentProfileTable,
  DharmaContainmentReceiptTable,
  DharmaContainmentViolationTable,
  DharmaContainmentResourceLimitTable,
  DharmaContainmentProcessTreeTable,
  DharmaContainmentSecretPolicyTable,
  DharmaContainmentNetworkPolicyTable,
  DharmaContainmentDestructionTable,
  DHARMA_CONTAINMENT_SCHEMA,
} from "./containment-schema.pg.sql"
