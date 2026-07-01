/**
 * Prism KV Handoff Protocol Simulation — Cancellation Logic
 */

import type { HandoffState, HandoffFailureClass } from "./handoff-types"
import { canCancel } from "./handoff-state-machine"

/**
 * Delegates to the state machine's cancellation guard.
 *
 * A request can be cancelled from any state that lists "cancelled" among its
 * valid transitions.
 */
export function canCancelRequest(state: HandoffState): boolean {
  return canCancel(state)
}

/**
 * Returns the operational effects of a cancellation given the current state.
 *
 * - `sourceNamespaceAction`: what to do with the source KV namespace.
 * - `destinationAction`: what to do with the destination-side import/state.
 * - `abortTransfer`: whether an in-flight transfer should be aborted.
 */
export function getCancellationEffect(state: HandoffState): {
  sourceNamespaceAction: string
  destinationAction: string
  abortTransfer: boolean
} {
  switch (state) {
    case "export_preparing":
      return {
        sourceNamespaceAction: "retain",
        destinationAction: "noop",
        abortTransfer: false,
      }

    case "exported":
      return {
        sourceNamespaceAction: "retain",
        destinationAction: "discard_manifest",
        abortTransfer: false,
      }

    case "transferring":
      return {
        sourceNamespaceAction: "retain",
        destinationAction: "discard_manifest",
        abortTransfer: true,
      }

    case "importing":
      return {
        sourceNamespaceAction: "retain",
        destinationAction: "discard_import",
        abortTransfer: false,
      }

    case "rollback_required":
      return {
        sourceNamespaceAction: "release",
        destinationAction: "rollback_destination",
        abortTransfer: false,
      }

    default:
      return {
        sourceNamespaceAction: "retain",
        destinationAction: "noop",
        abortTransfer: false,
      }
  }
}

/**
 * Classifies the reason for cancellation into a `HandoffFailureClass` based on
 * the state at the time of cancellation.
 */
export function classifyCancellation(
  state: HandoffState,
): HandoffFailureClass {
  switch (state) {
    case "export_preparing":
      return "source_export_failed"

    case "exported":
    case "transferring":
    case "importing":
      return "transfer_cancelled"

    case "destination_validated":
    case "committed":
      return "destination_import_failed"

    case "rollback_required":
      return "destination_activation_failed"

    default:
      return "request_cancelled"
  }
}
