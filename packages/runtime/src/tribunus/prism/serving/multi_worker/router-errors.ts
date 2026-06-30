export class RouterError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "RouterError"; this.code = code }
}
export class CompatibilityError extends RouterError {
  constructor(message: string) { super("COMPATIBILITY_ERROR", message) }
}
export class NoEligibleWorkerError extends RouterError {
  constructor() { super("NO_ELIGIBLE_WORKER", "No eligible worker available for request") }
}
export class WorkerDiscoveryError extends RouterError {
  constructor(message: string) { super("WORKER_DISCOVERY_ERROR", message) }
}
export class RouteRetryError extends RouterError {
  constructor(message: string) { super("ROUTE_RETRY_ERROR", message) }
}
export class PrefixAffinityError extends RouterError {
  constructor(message: string) { super("PREFIX_AFFINITY_ERROR", message) }
}
export class DrainError extends RouterError {
  constructor(message: string) { super("DRAIN_ERROR", message) }
}
export class FailoverError extends RouterError {
  constructor(message: string) { super("FAILOVER_ERROR", message) }
}
export class KxIndexError extends RouterError {
  constructor(message: string) { super("KV_INDEX_ERROR", message) }
}
