/**
 * Prism Local-Host KV Transport — Metrics
 *
 * Canonical metric names for local-host transport observability.
 */

import { LOCAL_TRANSPORT_METRICS } from "./local-transport-types"

/**
 * Return the canonical list of local transport metric names as a string
 * array.  The source of truth is `LOCAL_TRANSPORT_METRICS` in
 * local-transport-types.ts.
 */
export function getLocalTransportMetricNames(): string[] {
  return [...LOCAL_TRANSPORT_METRICS]
}
