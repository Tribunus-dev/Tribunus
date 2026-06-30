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
