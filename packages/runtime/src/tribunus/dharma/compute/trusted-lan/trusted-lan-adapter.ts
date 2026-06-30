/**
 * Dharma Trusted-LAN — DharmaPrismLanProviderAdapter
 *
 * Service boundary between the Dharma session aggregate and a specific
 * Prism LAN provider. Implementations wrap real provider endpoints or
 * local provider processes.
 *
 * This is the interface the session aggregate uses to interact with a
 * provider that participates in the trusted-LAN compute extension.
 * Each method maps to a lifecycle phase: capability discovery →
 * lease validation → admission → execution → receipt → teardown.
 */

import type {
  PrismLanCapabilityAdvertisement,
  PrismLanComputeLease,
  PrismLanUsageReceipt,
} from "./trusted-lan-types.ts"

export interface DharmaPrismLanProviderAdapter {
  /**
   * Return the provider's currently advertised capabilities as digest strings.
   * These represent the artifact digests (model checkpoints, tokenizers) and
   * containment profiles the provider makes available to authorized requesters.
   */
  getProviderCapabilities(): string[]

  /**
   * Publish a capability advertisement to the trusted-LAN. The advertisement
   * is a signed document encoding the provider's compute and security posture.
   * Advertisements are distributed among session participants via the LAN
   * discovery layer.
   */
  publishCapabilityAdvertisement(ad: PrismLanCapabilityAdvertisement): void

  /**
   * Validate an incoming lease request against the provider's current state.
   * Returns a structured result: `{ valid: true }` if the lease is admissible,
   * or `{ valid: false, rejectionClass, reason }` with the rejection class
   * matching one of the ProviderRejectionClass values.
   */
  validateLease(lease: PrismLanComputeLease): {
    valid: boolean
    rejectionClass?: string
    reason?: string
  }

  /**
   * Admit an approved lease — allocate provider-side resources and transition
   * the lease to the "admitted" state. The admission creates the KV namespace
   * and prepares the compute environment. Throws if the lease is unknown or
   * already admitted.
   */
  admitLease(leaseId: string): void

  /**
   * Cancel a lease, releasing all provider-side resources. No receipt is
   * generated for cancelled leases. This is the provider-side equivalent of
   * a requester-initiated cancel or session-global revocation.
   */
  cancel(leaseId: string): void

  /**
   * Finalize and return a usage receipt for a completed lease. The receipt
   * captures actual token usage, duration, and memory statistics for audit
   * and accounting. Returns null if the lease has not completed execution,
   * or if it was cancelled/failed without a receipt.
   */
  finalizeUsageReceipt(leaseId: string): PrismLanUsageReceipt | null

  /**
   * Release the KV namespace associated with a completed or cancelled lease.
   * Returns resources (key-value storage, ephemeral model cache) to the
   * provider pool. Idempotent — calling twice is safe.
   */
  releaseKvNamespace(leaseId: string): void

  /**
   * Recover all leased resources after a provider crash or network
   * partition. Returns the lease IDs that were recovered and still
   * require reconciliation (e.g., receipt finalization or cleanup).
   * Called during provider initialization to restore from provider-local
   * durable state.
   */
  recoverLeases(): string[]

  /**
   * Enter draining mode: stop accepting new leases while completing or
   * cancelling in-flight work. After draining, the provider may shut down
   * or be taken offline for maintenance.
   */
  enterDraining(): void
}
