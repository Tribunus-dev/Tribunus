/**
 * Dharma Local Prism Compute — Barrel
 *
 * Re-exports all public APIs from the compute lease module.
 */

// Types
export type {
  ComputeBackendKind,
  ComputeWorkloadClass,
  ComputeLeaseStatus,
  InputDisclosureClass,
  OutputDisclosureClass,
  LocalPrismComputeLease,
  ArtifactAdmissionState,
  WeightFormat,
  QuantizationScheme,
  PrismArtifactAdmission,
  ComputeImagePolicy,
  ComputeBudget,
  PrismExecutionDescriptor,
  KvNamespaceState,
  LocalKvNamespace,
  FailureClass,
  PrismUsageReceipt,
  ComputeEventType,
  ComputeCapability,
  SessionComputeSummary,
} from "./compute-types"
export {
  COMPUTE_EVENT_TYPES,
  COMPUTE_CAPABILITIES,
} from "./compute-types"

// Errors
export {
  ComputeError,
  LeaseError,
  ArtifactError,
  BudgetExceededError,
  PrismAdapterError,
  TargetIncompatibleError,
  ComputeCancelledError,
} from "./compute-errors"

// Lease lifecycle (pure functions)
export type {} from "./compute-lease"
export {} from "./compute-lease"

// Budget enforcement (pure functions)
export type {} from "./compute-budget"
export {} from "./compute-budget"

// Artifact admission (pure functions)
export type {} from "./compute-artifact"
export {} from "./compute-artifact"

// Prism adapter (adapter contract)
export type {} from "./compute-prism-adapter"
export {} from "./compute-prism-adapter"

// Execution (pure functions)
export type {} from "./compute-execution"
export {} from "./compute-execution"

// Usage receipts (pure functions)
export {
  createUsageReceipt,
  isSuccessfulReceipt,
  getReceiptSummary,
} from "./compute-receipt"

// KV namespace tracking (pure functions)
export type { KvAction } from "./compute-kv"
export {
  createKvNamespace,
  applyKvAction,
  VALID_KV_TRANSITIONS,
} from "./compute-kv"

// API
export { ComputeApi } from "./compute-api"

// Schema
export {
  DharmaComputePolicyTable,
  DharmaComputeLeaseTable,
  DharmaComputeExecutionTable,
  DharmaPrismArtifactTable,
  DharmaPrismComputeImageTable,
  DharmaPrismUsageReceiptTable,
  DharmaPrismKvNamespaceTable,
  DharmaComputeBudgetViolationTable,
  DharmaComputeCancellationTable,
  DharmaComputeRecoveryStateTable,
  DHARMA_COMPUTE_SCHEMA,
} from "./compute-schema.pg.sql"

// ── Trusted-LAN Compute ────────────────────────────────────────────────────

export type {
  EnrollmentState,
  ProviderHealthState,
  PrismLanProvider,
  ArtifactSummary,
  PrismLanCapabilityAdvertisement,
  PrismLanProviderTrust,
  TrustScopeKind,
  LanPairing,
  PairingStatus,
  LanComputeHandshake,
  LanComputeHandshakeAcceptance,
  LeaseBackendKind,
  RemoteLeaseStatus,
  ArtifactParityMode,
  PrismLanComputeLease,
  ProviderRejectionClass,
  FrameKind,
  LanComputeOutputFrame,
  ProviderKvState,
  ProviderKvNamespace,
  PrismLanUsageReceipt,
  LanComputeEventType,
} from "./trusted-lan/trusted-lan-types"
export {
  LAN_COMPUTE_EVENT_TYPES,
} from "./trusted-lan/trusted-lan-types"

// Errors
export {
  LanComputeError,
  ProviderError,
  TrustError,
  TransportError,
  HandshakeError,
  LeaseAdmissionError,
  PairingError,
  LanReceiptError,
} from "./trusted-lan/trusted-lan-errors"

// Lifecycle (pure functions)
export type {
  EnrollmentAction,
  LanLeaseAction,
} from "./trusted-lan/trusted-lan-lifecycle"
export {
  applyEnrollmentAction,
  isProviderActive,
  VALID_ENROLLMENT_TRANSITIONS,
  applyLanLeaseAction,
  isTerminalLanLease,
  VALID_LAN_LEASE_TRANSITIONS,
  VALID_HEALTH_TRANSITIONS,
} from "./trusted-lan/trusted-lan-lifecycle"

// API
export { TrustedLanApi } from "./trusted-lan/trusted-lan-api"

// Schema
export {
  DharmaLanProviderTable,
  DharmaLanProviderCapabilityTable,
  DharmaLanProviderTrustTable,
  DharmaLanPairingTable,
  DharmaLanDiscoverySessionTable,
  DharmaLanTransportSessionTable,
  DharmaLanLeaseTable,
  DharmaLanLeaseAdmissionTable,
  DharmaLanExecutionTable,
  DharmaLanUsageReceiptTable,
  DharmaLanKvNamespaceTable,
  DharmaLanCancellationTable,
  DharmaLanProviderHealthTable,
  DharmaLanRecoveryStateTable,
  DHARMA_TRUSTED_LAN_SCHEMA,
} from "./trusted-lan/trusted-lan-schema.pg.sql"
