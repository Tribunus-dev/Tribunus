/**
 * Dharma Trusted-LAN Prism Compute — Barrel
 *
 * Re-exports all public APIs from the trusted-LAN compute module.
 */

// Types
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
} from "./trusted-lan-types"
export {
  LAN_COMPUTE_EVENT_TYPES,
} from "./trusted-lan-types"

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
} from "./trusted-lan-errors"

// Lifecycle (pure functions)
export type {
  EnrollmentAction,
  LanLeaseAction,
} from "./trusted-lan-lifecycle"
export {
  applyEnrollmentAction,
  isProviderActive,
  VALID_ENROLLMENT_TRANSITIONS,
  applyLanLeaseAction,
  isTerminalLanLease,
  VALID_LAN_LEASE_TRANSITIONS,
  VALID_HEALTH_TRANSITIONS,
} from "./trusted-lan-lifecycle"

// API
export { TrustedLanApi } from "./trusted-lan-api"

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
} from "./trusted-lan-schema.pg.sql"
