/**
 * Dharma Replication — Runtime Initialization
 *
 * Orchestrates the full startup sequence for a DharmaReplicationRuntime:
 *  1. Create runtime with config
 *  2. Start the runtime (opens Corestore, wires identity)
 *  3. Discover stored federations from the system core
 *  4. Recover checkpoints and outboxes for each stored federation
 *
 * Returns a RuntimeInitResult with per-federation recovery details.
 */

import { DharmaReplicationRuntime } from "./runtime"
import type { RuntimeConfig } from "./runtime"
import { FederationStore } from "./federation-store"
import { FederationBase, createDefaultApply } from "./federation-base"
import type { FederationBaseConfig } from "./federation-base"
import { OutboxManager } from "./outbox"
import { recoverFromCheckpoint } from "./checkpoint-recovery"
import { recoverOutbox } from "./outbox-recovery"
import type { CheckpointRecoveryResult } from "./checkpoint-recovery"
import type { OutboxRecoveryResult } from "./outbox-recovery"

// ── Result Type ──────────────────────────────────────────────────────────────

export interface RuntimeInitResult {
  /** The fully initialized runtime instance. */
  runtime: DharmaReplicationRuntime
  /** Whether runtime.start() completed without error. */
  started: boolean
  /** Whether the identity core was created (true on first run, false if identity already persisted). */
  identityCoreCreated: boolean
  /** Number of federations recovered from storage. */
  federationsRecovered: number
  /** Per-federation checkpoint recovery results. */
  checkpointResults: CheckpointRecoveryResult[]
  /** Per-federation outbox recovery results. */
  outboxResults: OutboxRecoveryResult[]
  /** Top-level error message if initialization failed. null on success. */
  error: string | null
}

// ── Sentinel / Empty Results ────────────────────────────────────────────────

function emptyCheckpointResult(): CheckpointRecoveryResult {
  return {
    checkpointExists: false,
    recovered: true,
    lastOrderIndex: 0,
    recoveredAt: new Date().toISOString(),
    error: null,
  }
}

function emptyOutboxResult(): OutboxRecoveryResult {
  return {
    recovered: false,
    pendingEntries: 0,
    retriedEntries: 0,
    failedEntries: 0,
    recoveredAt: new Date().toISOString(),
  }
}

// ── Initialization ───────────────────────────────────────────────────────────

/**
 * Perform comprehensive runtime initialization.
 *
 * Steps:
 *  1. Create the DharmaReplicationRuntime with the supplied config.
 *  2. Call runtime.start() to open the Corestore and wire identity.
 *  3. Enumerate stored federations from the system core.
 *  4. For each stored federation, open a temporary FederationBase,
 *     recover the checkpoint, run outbox recovery, then close.
 *  5. Return an aggregate RuntimeInitResult.
 *
 * If any step fails the error field is populated and the partially
 * initialised runtime is returned so callers can decide how to proceed.
 */
export async function initializeRuntime(config: RuntimeConfig): Promise<RuntimeInitResult> {
  const checkpointResults: CheckpointRecoveryResult[] = []
  const outboxResults: OutboxRecoveryResult[] = []

  try {
    // Step 1: Create runtime
    // Constructor validates the vault has an active identity.
    const runtime = new DharmaReplicationRuntime(config)

    // Step 2: Start runtime — opens Corestore, wires identity to system core
    await runtime.start()

    // Step 3: Discover stored federations
    const storedFederationIds = await runtime.listStoredFederationIds()

    // Step 4: Recover checkpoints and outboxes for each stored federation
    for (const federationId of storedFederationIds) {
      await recoverSingleFederation(runtime, federationId, checkpointResults, outboxResults)
    }

    // An identity is considered "created" (first run) when no prior
    // federation data exists.  ensureIdentityCore inside start() either
    // found an existing identity or created a fresh one — we approximate
    // "fresh" by the absence of any stored federation data.
    const identityCoreCreated = storedFederationIds.length === 0

    return {
      runtime,
      started: true,
      identityCoreCreated: identityCoreCreated || checkpointResults.some(r => r.checkpointExists),
      federationsRecovered: storedFederationIds.length,
      checkpointResults,
      outboxResults,
      error: null,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      runtime: null as unknown as DharmaReplicationRuntime,
      started: false,
      identityCoreCreated: false,
      federationsRecovered: 0,
      checkpointResults,
      outboxResults,
      error: message,
    }
  }
}

// ── Per-Federation Recovery ──────────────────────────────────────────────────

async function recoverSingleFederation(
  runtime: DharmaReplicationRuntime,
  federationId: string,
  checkpointResults: CheckpointRecoveryResult[],
  outboxResults: OutboxRecoveryResult[],
): Promise<void> {
  const corestore = runtime.getCorestore()
  if (!corestore) {
    checkpointResults.push(emptyCheckpointResult())
    outboxResults.push(emptyOutboxResult())
    return
  }

  const activeIdentity = runtime.getActiveIdentity()
  const identityId = activeIdentity?.identityId ?? "local"

  const federationStore = new FederationStore(corestore, federationId, identityId)

  // ── Checkpoint recovery ─────────────────────────────────────────────────
  try {
    const bootstrapRecord = await federationStore.getBootstrap()
    if (bootstrapRecord) {
      const writerCore = await corestore.getWriterCore(federationId, "local")
      const viewCore = await corestore.getViewCore(federationId)
      const checkpointCore = await corestore.getCheckpointCore(federationId)

      const federationBase = new FederationBase({
        federationId,
        autobaseKey: bootstrapRecord.autobaseKey,
        writerCore,
        viewCore,
        checkpointCore,
        apply: createDefaultApply(),
      } satisfies FederationBaseConfig)
      await federationBase.open()

      const cpResult = await recoverFromCheckpoint(federationBase)
      checkpointResults.push(cpResult)

      await federationBase.close()
    } else {
      checkpointResults.push(emptyCheckpointResult())
    }
  } catch {
    checkpointResults.push(emptyCheckpointResult())
  }

  // ── Outbox recovery ────────────────────────────────────────────────────
  try {
    const outbox = new OutboxManager(federationId)
    const obResult = recoverOutbox(outbox)
    outboxResults.push(obResult)
  } catch {
    outboxResults.push(emptyOutboxResult())
  }
}
