/**
 * Prism Local-Host KV Transport — Timeouts
 *
 * Pure helpers for deadline arithmetic and timeout classification.
 */

import type { TransportTimeoutClass } from "./local-transport-types"

/**
 * Check whether the elapsed wall-clock time since `startedAt` exceeds
 * `timeoutMs`.
 *
 * Both arguments are ISO-8601 strings; `startedAt` is always the reference
 * point.  Returns `true` when the deadline has passed or `startedAt` is
 * unparseable.
 */
export function isTimeoutElapsed(startedAt: string, timeoutMs: number): boolean {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return true
  return Date.now() - start >= timeoutMs
}

/**
 * Compute the absolute ISO-8601 deadline from a starting time and a
 * duration in milliseconds.  Returns the deadline string, or `startedAt`
 * unchanged when `startedAt` is unparseable.
 */
export function getTimeoutDeadline(startedAt: string, timeoutMs: number): string {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return startedAt
  return new Date(start + timeoutMs).toISOString()
}

/**
 * Return a human-readable label for a `TransportTimeoutClass`.
 */
export function classifyTimeout(cls: TransportTimeoutClass): string {
  switch (cls) {
    case "serialization_timeout":
      return "source serialization did not complete within the budget"
    case "descriptor_delivery_timeout":
      return "segment descriptor was not delivered to the destination within the budget"
    case "destination_map_timeout":
      return "destination did not map the shared-memory segment within the budget"
    case "integrity_validation_timeout":
      return "integrity validation on the destination side did not complete within the budget"
    case "deserialization_timeout":
      return "destination deserialisation did not complete within the budget"
    case "acknowledgement_timeout":
      return "destination did not acknowledge the import within the budget"
    case "source_cleanup_timeout":
      return "source-side cleanup did not complete within the budget"
    case "transport_session_timeout":
      return "the overall transport session exceeded its time budget"
  }
}
