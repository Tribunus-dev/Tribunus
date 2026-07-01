/**
 * Prism Local-Host KV Transport — Cancellation
 *
 * Pure functions for determining cancellation effects based on the
 * stage at which a handoff / transport session is cancelled.
 */

/**
 * Stages are ordered: the earlier the cancellation, the less cleanup is needed.
 * "pre_handshake"           — before any transport activity
 * "handshake"               — during control-plane handshake
 * "handoff_offer"           — after handshake, before export
 * "export_ready"            — source has signalled readiness
 * "segment_descriptor"      — segment descriptor delivered
 * "import_started"          — destination began mapping/reading
 * "import_verified"         — destination verified integrity
 * "import_activated"        — import activated (payload consumable)
 * "import_acknowledged"     — destination acknowledged receipt
 * "post_commit"             — after commit, source and dest both done
 * "source_cleanup"          — during source-side cleanup
 */
export type LocalTransportCancellationStage =
  | "pre_handshake"
  | "handshake"
  | "handoff_offer"
  | "export_ready"
  | "segment_descriptor"
  | "import_started"
  | "import_verified"
  | "import_activated"
  | "import_acknowledged"
  | "post_commit"
  | "source_cleanup"

/**
 * Return the specific effects required for a cancellation at the given stage.
 *
 * - `releaseSegment` — the shared-memory segment should be released
 * - `invalidateDest` — the destination's mapping/view should be invalidated
 * - `retainSource`   — the source retains ownership (no handoff confirmed)
 * - `needsRollback`  — a rollback control message is needed
 */
export function getCancellationEffect(
  stage: LocalTransportCancellationStage,
): { releaseSegment: boolean; invalidateDest: boolean; retainSource: boolean; needsRollback: boolean } {
  switch (stage) {
    case "pre_handshake":
      return { releaseSegment: false, invalidateDest: false, retainSource: true, needsRollback: false }
    case "handshake":
      return { releaseSegment: false, invalidateDest: false, retainSource: true, needsRollback: false }
    case "handoff_offer":
      return { releaseSegment: false, invalidateDest: false, retainSource: true, needsRollback: false }
    case "export_ready":
      return { releaseSegment: true, invalidateDest: false, retainSource: true, needsRollback: true }
    case "segment_descriptor":
      return { releaseSegment: true, invalidateDest: true, retainSource: true, needsRollback: true }
    case "import_started":
      return { releaseSegment: true, invalidateDest: true, retainSource: false, needsRollback: true }
    case "import_verified":
      return { releaseSegment: true, invalidateDest: true, retainSource: false, needsRollback: true }
    case "import_activated":
      return { releaseSegment: true, invalidateDest: true, retainSource: false, needsRollback: true }
    case "import_acknowledged":
      return { releaseSegment: false, invalidateDest: false, retainSource: false, needsRollback: false }
    case "post_commit":
      return { releaseSegment: false, invalidateDest: false, retainSource: false, needsRollback: false }
    case "source_cleanup":
      return { releaseSegment: false, invalidateDest: false, retainSource: false, needsRollback: false }
  }
}

/**
 * Classify a cancellation stage into a human-readable severity label.
 *
 * Returns one of: "harmless", "mid_handoff", "deep_import", "late"
 */
export function classifyCancelState(stage: LocalTransportCancellationStage): string {
  switch (stage) {
    case "pre_handshake":
    case "handshake":
    case "handoff_offer":
      return "harmless"
    case "export_ready":
    case "segment_descriptor":
      return "mid_handoff"
    case "import_started":
    case "import_verified":
    case "import_activated":
      return "deep_import"
    case "import_acknowledged":
    case "post_commit":
    case "source_cleanup":
      return "late"
  }
}
