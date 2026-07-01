/**
 * Prism KV Handoff Protocol Simulation — Types
 */

// ── Handoff Request ---------------------------------------------------------

export type HandoffMode = "simulation_only" | "future_transport_required"
export type SourceRetentionPolicy = "retain_until_destination_commit" | "retain_until_decode_completion" | "release_after_destination_commit" | "invalidate_after_destination_commit"
export type PhaseCoLocationPolicy = "same_worker_required" | "simulated_handoff_required" | "future_transport_required" | "not_supported"

export interface PrismKvHandoffRequest {
  handoffId: string
  routeId: string
  requestId: string
  executionId: string
  sessionId: string | null
  dharmaLeaseId: string | null
  sourceWorkerId: string
  sourceWorkerInstanceId: string
  destinationWorkerId: string
  destinationWorkerInstanceId: string
  sourceKvNamespaceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  sourceComputeImageDigest: string
  destinationComputeImageDigest: string
  handoffMode: HandoffMode
  sourceRetentionPolicy: SourceRetentionPolicy
  requestedDeadlineAt: string
  requestedBy: string
  authorizationDigest: string
  createdAt: string
  signature: string | null
}

// ── State Machine -----------------------------------------------------------

export type HandoffState =
  | "draft" | "requested" | "source_validating" | "destination_validating"
  | "export_preparing" | "exported" | "transferring" | "importing"
  | "destination_validated" | "committed" | "source_disposition_pending" | "completed"
  | "rejected" | "cancelled" | "timeout" | "expired" | "failed" | "rolled_back" | "degraded_completed"
  | "rollback_required"

export type HandoffAction =
  | "request" | "validate_source" | "validate_destination"
  | "prepare_export" | "export" | "transfer" | "import"
  | "validate_destination_import" | "commit" | "dispose_source" | "complete"
  | "reject" | "cancel" | "expire" | "timeout" | "fail" | "rollback"

// ── Compatibility -----------------------------------------------------------

export interface PrismKvCompatibilityDescriptor {
  compatibilityVersion: number
  modelArtifactDigest: string
  tokenizerDigest: string
  architectureDigest: string
  attentionLayoutDigest: string
  ropeConfigurationDigest: string
  kvQuantizationDigest: string
  kvPrecisionMode: string
  kvPageShape: string
  kvHeadLayout: string
  kvLayerCount: number
  kvHiddenDimension: number
  kvSequenceLength: number
  sourceComputeImageClass: string
  destinationComputeImageClass: string
  transferRepresentation: string
  targetEndianness: string | null
  targetAlignmentClass: string | null
}

export type CompatibilityMode = "strict" | "family" | "evaluation"

// ── Export Manifest ---------------------------------------------------------

export interface PrismKvExportManifest {
  manifestId: string
  handoffId: string
  sourceWorkerId: string
  sourceWorkerInstanceId: string
  sourceKvNamespaceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  compatibilityDescriptorDigest: string
  transferRepresentation: string
  sequenceLength: number
  pageCount: number
  byteLength: number
  deterministicContentDigest: string
  exportGeneration: number
  exportedAt: string
  expiresAt: string
  sourceSignature: string
}

// ── Simulation Payload ------------------------------------------------------

export interface PrismKvSimulationPayload {
  payloadId: string
  handoffId: string
  sourceKvNamespaceId: string
  modelArtifactDigest: string
  tokenizerDigest: string
  compatibilityDescriptorDigest: string
  sequenceLength: number
  layerCount: number
  pageCount: number
  byteLength: number
  deterministicContentDigest: string
  fixtureSeed: string
  payloadVersion: number
}

// ── Destination Import ------------------------------------------------------

export type ImportState =
  | "created" | "payload_received" | "integrity_validated" | "compatibility_validated"
  | "namespace_materialized" | "activated" | "acknowledged" | "failed" | "rolled_back"

export interface PrismKvImportRecord {
  importId: string
  handoffId: string
  destinationWorkerId: string
  destinationWorkerInstanceId: string
  destinationKvNamespaceId: string | null
  manifestDigest: string
  compatibilityDescriptorDigest: string
  payloadDigest: string
  importGeneration: number
  state: ImportState
  importedAt: string | null
  validatedAt: string | null
  activatedAt: string | null
  failureClass: string | null
}

// ── Source Disposition ------------------------------------------------------

export type SourceDispositionState = "retained" | "released" | "invalidated" | "pending"

export interface SourceDispositionRecord {
  handoffId: string
  sourceWorkerId: string
  sourceWorkerInstanceId: string
  sourceKvNamespaceId: string
  policy: SourceRetentionPolicy
  state: SourceDispositionState
  deadlineAt: string | null
  resolvedAt: string | null
}

// ── Handoff Receipt ---------------------------------------------------------

export interface PrismKvHandoffReceipt {
  receiptId: string
  handoffId: string
  routeId: string
  requestId: string
  dharmaLeaseId: string | null
  sessionId: string | null
  sourceWorkerId: string
  sourceWorkerInstanceId: string
  destinationWorkerId: string
  destinationWorkerInstanceId: string
  sourceKvNamespaceDigest: string
  destinationKvNamespaceDigest: string | null
  modelArtifactDigest: string
  tokenizerDigest: string
  compatibilityDescriptorDigest: string
  sourceComputeImageDigest: string
  destinationComputeImageDigest: string
  transferRepresentation: string
  handoffMode: string
  manifestDigest: string
  payloadDigest: string
  byteLength: number
  sequenceLength: number
  pageCount: number
  sourceExportDurationMs: number | null
  transferDurationMs: number | null
  destinationImportDurationMs: number | null
  totalDurationMs: number
  sourceDisposition: string
  finalState: HandoffState
  failureClass: string | null
  emittedAt: string
  sourceSignature: string
  destinationSignature: string | null
  coordinatorSignature: string
}

// ── Failure Classes ---------------------------------------------------------

export type HandoffFailureClass =
  | "handoff_authorization_failed" | "source_export_failed"
  | "destination_validation_failed" | "manifest_invalid"
  | "payload_corrupted" | "payload_truncated" | "payload_digest_mismatch"
  | "transfer_timeout" | "transfer_cancelled"
  | "destination_import_failed" | "destination_activation_failed"
  | "destination_ack_lost" | "source_disposition_failed"
  | "source_restart" | "destination_restart"
  | "lease_revoked" | "request_cancelled" | "handoff_expired"
  | "duplicate_delivery" | "replay_detected"

// ── Source Rejection Classes ------------------------------------------------

export type SourceRejectionClass =
  | "source_worker_unavailable" | "source_instance_mismatch"
  | "source_execution_pin_invalid" | "source_namespace_missing"
  | "source_namespace_not_exportable" | "prefill_not_completed"
  | "source_namespace_invalidated" | "request_cancelled"
  | "lease_revoked" | "artifact_mismatch" | "tokenizer_mismatch"
  | "source_capacity_exceeded" | "handoff_export_not_supported"

// ── Destination Rejection Classes -------------------------------------------

export type DestinationRejectionClass =
  | "destination_worker_unavailable" | "destination_instance_mismatch"
  | "destination_decode_unsupported" | "destination_import_not_supported"
  | "destination_artifact_mismatch" | "destination_tokenizer_mismatch"
  | "destination_layout_incompatible" | "destination_compute_image_incompatible"
  | "destination_capacity_exceeded" | "destination_kv_capacity_exceeded"
  | "destination_draining" | "request_cancelled" | "lease_revoked"

// ── Disaggregated Route Plan ------------------------------------------------

export interface PrismDisaggregatedRoutePlan {
  routeId: string
  requestId: string
  prefillWorkerId: string
  decodeWorkerId: string
  executionPinningPolicy: PhaseCoLocationPolicy
  handoffRequired: boolean
  handoffId: string | null
  handoffMode: HandoffMode | null
  compatibilityResult: string | null
  sourceRetentionPolicy: SourceRetentionPolicy
  handoffDeadlineAt: string | null
  prefillSelectionReason: string
  decodeSelectionReason: string
  handoffSelectionReason: string | null
  routeState: string
}

// ── Dharma Handoff Policy ---------------------------------------------------

export interface DharmaPrismHandoffPolicy {
  allowSimulatedHandoff: boolean
  allowFutureTransportHandoff: boolean
  allowedSourceWorkers: string[]
  allowedDestinationWorkers: string[]
  requiredArtifactParityMode: string
  requiredTransferRepresentation: string | null
  maximumHandoffBytes: number
  maximumHandoffDurationMs: number
  sourceRetentionPolicy: SourceRetentionPolicy
  requireHandoffReceipt: boolean
  requireDestinationSignature: boolean
}

// ── Transport Adapter -------------------------------------------------------

export interface PrismKvTransportAdapter {
  prepareTransfer(handoffId: string, manifest: PrismKvExportManifest): Promise<{ prepared: boolean; reason: string | null }>
  transfer(handoffId: string): Promise<{ transferred: boolean; payloadDigest: string; bytes: number }>
  acknowledgeImport(handoffId: string): Promise<{ acknowledged: boolean }>
  abortTransfer(handoffId: string): Promise<void>
  getTransferStatus(handoffId: string): Promise<{ state: string; progressBytes: number }>
}

// ── Handoff Metrics Names ---------------------------------------------------

export const HANDOFF_METRICS = [
  "prism_kv_handoff_requests_total", "prism_kv_handoff_inflight",
  "prism_kv_handoff_completed_total", "prism_kv_handoff_failed_total",
  "prism_kv_handoff_cancelled_total", "prism_kv_handoff_rollback_total",
  "prism_kv_handoff_degraded_completed_total",
  "prism_kv_handoff_duration_seconds", "prism_kv_handoff_export_duration_seconds",
  "prism_kv_handoff_transfer_duration_seconds", "prism_kv_handoff_import_duration_seconds",
  "prism_kv_handoff_bytes",
  "prism_kv_handoff_source_retained_total", "prism_kv_handoff_source_released_total",
  "prism_kv_handoff_integrity_failures_total",
  "prism_kv_handoff_compatibility_rejections_total",
  "prism_kv_handoff_duplicate_delivery_total",
] as const

// ─── Compatibility Report Extension -----------------------------------------

export interface LlmDKvHandoffCompatibilityReport {
  sameWorkerPhasePinningSupport: string
  simulatedKvHandoffSupport: string
  handoffReceiptSupport: string
  strictKvCompatibilityValidationSupport: string
  sourceRetentionPolicySupport: string
  simulatedFailureRecoverySupport: string
  realNetworkKvTransportSupport: string
  nixlConnectorSupport: string
  rdmaTransportSupport: string
  sharedKvStoreSupport: string
  productionPrefillDecodeDisaggregationSupport: string
  knownGaps: string[]
  deferredFeatures: string[]
  testEvidenceRefs: string[]
}
