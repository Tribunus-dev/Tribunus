/**
 * Prism KV Handoff Protocol — Source Export Eligibility
 *
 * Pure function that evaluates 13 independent eligibility checks for
 * source-side KV cache export. Each boolean flag corresponds to one
 * SourceRejectionClass. Returns the first rejection encountered.
 */

import type { PrismKvHandoffRequest, SourceRejectionClass } from "./handoff-types"

export function checkSourceExportEligibility(
  _request: PrismKvHandoffRequest,
  active: boolean,
  instanceMatch: boolean,
  pinValid: boolean,
  nsExists: boolean,
  nsExportable: boolean,
  prefillComplete: boolean,
  nsNotInvalidated: boolean,
  notCancelled: boolean,
  notRevoked: boolean,
  artifactMatch: boolean,
  tokenizerMatch: boolean,
  capacityOk: boolean,
  exportSupported: boolean,
): { eligible: boolean; rejectionClass: SourceRejectionClass | null; reason: string | null } {
  if (!active) {
    return { eligible: false, rejectionClass: "source_worker_unavailable", reason: "Source worker is not active" }
  }
  if (!instanceMatch) {
    return { eligible: false, rejectionClass: "source_instance_mismatch", reason: "Source worker instance ID does not match the handoff request" }
  }
  if (!pinValid) {
    return { eligible: false, rejectionClass: "source_execution_pin_invalid", reason: "Source execution pin is invalid or misaligned with the current deployment" }
  }
  if (!nsExists) {
    return { eligible: false, rejectionClass: "source_namespace_missing", reason: "Source KV namespace does not exist on the worker" }
  }
  if (!nsExportable) {
    return { eligible: false, rejectionClass: "source_namespace_not_exportable", reason: "Source KV namespace is not marked exportable" }
  }
  if (!prefillComplete) {
    return { eligible: false, rejectionClass: "prefill_not_completed", reason: "Prefill phase has not completed for the source KV namespace" }
  }
  if (!nsNotInvalidated) {
    return { eligible: false, rejectionClass: "source_namespace_invalidated", reason: "Source KV namespace has been invalidated and cannot be exported" }
  }
  if (!notCancelled) {
    return { eligible: false, rejectionClass: "request_cancelled", reason: "Handoff request has been cancelled" }
  }
  if (!notRevoked) {
    return { eligible: false, rejectionClass: "lease_revoked", reason: "Handoff lease has been revoked" }
  }
  if (!artifactMatch) {
    return { eligible: false, rejectionClass: "artifact_mismatch", reason: "Model artifact digest does not match between request and source worker" }
  }
  if (!tokenizerMatch) {
    return { eligible: false, rejectionClass: "tokenizer_mismatch", reason: "Tokenizer digest does not match between request and source worker" }
  }
  if (!capacityOk) {
    return { eligible: false, rejectionClass: "source_capacity_exceeded", reason: "Source worker capacity is insufficient for the export" }
  }
  if (!exportSupported) {
    return { eligible: false, rejectionClass: "handoff_export_not_supported", reason: "This worker does not support handoff export for the given configuration" }
  }

  return { eligible: true, rejectionClass: null, reason: null }
}
