/**
 * Prism KV Handoff Protocol — Destination Import Eligibility
 *
 * Pure function that evaluates 13 independent eligibility checks for
 * destination-side KV cache import. Each boolean flag corresponds to one
 * DestinationRejectionClass. Returns the first rejection encountered.
 */

import type { PrismKvHandoffRequest, DestinationRejectionClass } from "./handoff-types"

export function checkDestinationImportEligibility(
  _request: PrismKvHandoffRequest,
  active: boolean,
  instanceMatch: boolean,
  decodeSupported: boolean,
  importSupported: boolean,
  artifactMatch: boolean,
  tokenizerMatch: boolean,
  layoutCompatible: boolean,
  computeImageCompatible: boolean,
  capacityOk: boolean,
  kvCapacityOk: boolean,
  notDraining: boolean,
  notCancelled: boolean,
  notRevoked: boolean,
): { eligible: boolean; rejectionClass: DestinationRejectionClass | null; reason: string | null } {
  if (!active) {
    return { eligible: false, rejectionClass: "destination_worker_unavailable", reason: "Destination worker is not active" }
  }
  if (!instanceMatch) {
    return { eligible: false, rejectionClass: "destination_instance_mismatch", reason: "Destination worker instance ID does not match the handoff request" }
  }
  if (!decodeSupported) {
    return { eligible: false, rejectionClass: "destination_decode_unsupported", reason: "Destination worker does not support the required KV cache decode format" }
  }
  if (!importSupported) {
    return { eligible: false, rejectionClass: "destination_import_not_supported", reason: "Destination worker does not support KV cache import operations" }
  }
  if (!artifactMatch) {
    return { eligible: false, rejectionClass: "destination_artifact_mismatch", reason: "Model artifact digest does not match between request and destination worker" }
  }
  if (!tokenizerMatch) {
    return { eligible: false, rejectionClass: "destination_tokenizer_mismatch", reason: "Tokenizer digest does not match between request and destination worker" }
  }
  if (!layoutCompatible) {
    return { eligible: false, rejectionClass: "destination_layout_incompatible", reason: "KV cache head layout is incompatible with the destination worker" }
  }
  if (!computeImageCompatible) {
    return { eligible: false, rejectionClass: "destination_compute_image_incompatible", reason: "Compute image is incompatible between source and destination" }
  }
  if (!capacityOk) {
    return { eligible: false, rejectionClass: "destination_capacity_exceeded", reason: "Destination worker capacity is insufficient for the import" }
  }
  if (!kvCapacityOk) {
    return { eligible: false, rejectionClass: "destination_kv_capacity_exceeded", reason: "Destination worker KV cache capacity is insufficient" }
  }
  if (!notDraining) {
    return { eligible: false, rejectionClass: "destination_draining", reason: "Destination worker is currently draining and cannot accept imports" }
  }
  if (!notCancelled) {
    return { eligible: false, rejectionClass: "request_cancelled", reason: "Handoff request has been cancelled" }
  }
  if (!notRevoked) {
    return { eligible: false, rejectionClass: "lease_revoked", reason: "Handoff lease has been revoked" }
  }

  return { eligible: true, rejectionClass: null, reason: null }
}
