/**
 * Prism llm-d Worker — Dharma Lease Correlation
 *
 * Pure functions for creating and validating Dharma worker correlations,
 * linking serving requests to their originating Dharma leases.
 */

import type { DharmaWorkerCorrelation } from "./worker-types"

export function createCorrelation(
  leaseId: string,
  sessionId: string,
  requesterDigest: string,
  disclosureClass: string,
): DharmaWorkerCorrelation {
  return {
    dharmaLeaseId: leaseId,
    sessionId,
    requesterIdentityDigest: requesterDigest,
    disclosureClass,
    resultBundleId: null,
  }
}

export function validateCorrelation(
  corr: DharmaWorkerCorrelation,
  expectedLeaseId: string,
  expectedSessionId: string,
): { valid: boolean; reason: string | null } {
  if (corr.dharmaLeaseId !== expectedLeaseId) {
    return {
      valid: false,
      reason: `lease id mismatch: expected ${expectedLeaseId}, got ${corr.dharmaLeaseId}`,
    }
  }
  if (corr.sessionId !== expectedSessionId) {
    return {
      valid: false,
      reason: `session id mismatch: expected ${expectedSessionId}, got ${corr.sessionId}`,
    }
  }
  if (!corr.requesterIdentityDigest || typeof corr.requesterIdentityDigest !== "string") {
    return { valid: false, reason: "missing requester identity digest" }
  }
  if (!corr.disclosureClass || typeof corr.disclosureClass !== "string") {
    return { valid: false, reason: "missing disclosure class" }
  }
  return { valid: true, reason: null }
}
