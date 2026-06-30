/**
 * Dharma Prism Local Adapter Contract
 *
 * Abstraction over the local Prism compute runtime. Concrete implementations
 * bridge to a specific backend (Ollama, llama.cpp, MLX, etc.).
 */

import type {
  ComputeWorkloadClass,
  PrismArtifactAdmission,
  LocalPrismComputeLease,
  PrismExecutionDescriptor,
  PrismUsageReceipt,
} from "./compute-types"

// ── Adapter Contract --------------------------------------------------------

export interface DharmaPrismLocalAdapter {
  /** Query backend capabilities. */
  getCapabilities(): {
    available: boolean
    supportedTargets: string[]
    supportedWorkloads: ComputeWorkloadClass[]
  }

  /** List all artifact digests currently admitted by the backend. */
  listAdmittedArtifacts(): PrismArtifactAdmission[]

  /** Inspect a specific admitted artifact by digest. */
  inspectArtifact(digest: string): PrismArtifactAdmission | null

  /**
   * Attempt to admit a compute lease for execution.
   * Returns admission outcome.
   */
  admitLease(
    lease: LocalPrismComputeLease,
  ): { admitted: boolean; reason: string | null }

  /**
   * Build a fully-resolved execution descriptor for an admitted lease.
   */
  prepareExecution(leaseId: string): Promise<PrismExecutionDescriptor>

  /** Pre-fill (prompt processing / context ingestion). */
  prefill(request: unknown): Promise<unknown>

  /** Single-turn decode (token generation). */
  decode(request: unknown): Promise<unknown>

  /** Streaming decode -- yields tokens as they are produced. */
  stream(request: unknown): AsyncIterable<unknown>

  /** Cancel a running execution and free backend resources. */
  cancel(leaseId: string): Promise<void>

  /** Get current execution status string. */
  getExecutionStatus(leaseId: string): string

  /** Retrieve a usage receipt for a completed/terminated lease. */
  getUsageReceipt(leaseId: string): PrismUsageReceipt | null

  /** Summarise KV cache namespace activity for a lease. */
  getKvSummary(leaseId: string): {
    namespaceCount: number
    activeNamespaces: number
    totalHits: number | null
  }

  /**
   * Recover any executions that were in-flight when the runtime
   * was last interrupted. Returns lease ids of resumed executions.
   */
  recoverPendingExecutions(): Promise<string[]>
}
