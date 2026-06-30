/**
 * Prism KV Handoff — Destination Import State Machine
 *
 * Pure functions managing import lifecycle at the destination (decode) worker.
 */

import type { PrismKvImportRecord, ImportState } from "./handoff-types"

// ── Import State Transition Table ───────────────────────────────────────────

const VALID_TRANSITIONS: Record<ImportState, Record<string, ImportState>> = {
  created:                     { receive_payload: "payload_received", fail: "failed", rollback: "rolled_back" },
  payload_received:            { validate_integrity: "integrity_validated", fail: "failed", rollback: "rolled_back" },
  integrity_validated:         { validate_compatibility: "compatibility_validated", fail: "failed", rollback: "rolled_back" },
  compatibility_validated:     { materialize_namespace: "namespace_materialized", fail: "failed", rollback: "rolled_back" },
  namespace_materialized:      { activate: "activated", fail: "failed", rollback: "rolled_back" },
  activated:                   { acknowledge: "acknowledged", fail: "failed", rollback: "rolled_back" },
  acknowledged:                { fail: "failed", rollback: "rolled_back" },
  failed:                      { rollback: "rolled_back" },
  rolled_back:                 {},
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createImportRecord(
  handoffId: string,
  destWorkerId: string,
  destInstanceId: string,
): PrismKvImportRecord {
  return {
    importId: `import_${handoffId}`,
    handoffId,
    destinationWorkerId: destWorkerId,
    destinationWorkerInstanceId: destInstanceId,
    destinationKvNamespaceId: null,
    manifestDigest: "",
    compatibilityDescriptorDigest: "",
    payloadDigest: "",
    importGeneration: 0,
    state: "created",
    importedAt: null,
    validatedAt: null,
    activatedAt: null,
    failureClass: null,
  }
}

// ── State Transition ────────────────────────────────────────────────────────

export function transitionImport(
  record: PrismKvImportRecord,
  action: string,
): PrismKvImportRecord {
  const currentState = record.state
  const allowed = VALID_TRANSITIONS[currentState]
  if (!allowed) {
    throw new Error(
      `cannot transition import from "${currentState}": unknown state`,
    )
  }

  const nextState = allowed[action]
  if (!nextState) {
    throw new Error(
      `cannot transition import from "${currentState}" via action "${action}": invalid transition`,
    )
  }

  const now = new Date().toISOString()
  const updated: Partial<PrismKvImportRecord> = { state: nextState }

  if (action === "receive_payload" || action === "materialize_namespace") {
    updated.importedAt = now
  }
  if (action === "validate_integrity" || action === "validate_compatibility") {
    updated.validatedAt = now
  }
  if (action === "activate") {
    updated.activatedAt = now
  }
  if (action === "fail") {
    updated.failureClass = "destination_import_failed"
  }

  return { ...record, ...updated }
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function isImportComplete(record: PrismKvImportRecord): boolean {
  return record.state === "activated" || record.state === "acknowledged"
}

export function isImportFailed(record: PrismKvImportRecord): boolean {
  return record.state === "failed" || record.state === "rolled_back"
}
