export class ComputeError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "ComputeError"; this.code = code }
}
export class LeaseError extends ComputeError {
  constructor(message: string) { super("LEASE_ERROR", message) }
}
export class ArtifactError extends ComputeError {
  constructor(message: string) { super("ARTIFACT_ERROR", message) }
}
export class BudgetExceededError extends ComputeError {
  readonly limit: string
  constructor(limit: string, actual: number, budget: number) {
    super("BUDGET_EXCEEDED", `${limit} exceeded: ${actual} > ${budget}`); this.limit = limit
  }
}
export class PrismAdapterError extends ComputeError {
  constructor(message: string) { super("PRISM_ADAPTER_ERROR", message) }
}
export class TargetIncompatibleError extends ComputeError {
  constructor(target: string, artifact: string) {
    super("TARGET_INCOMPATIBLE", `Target ${target} incompatible with artifact ${artifact}`)
  }
}
export class ComputeCancelledError extends ComputeError {
  constructor(leaseId: string) { super("COMPUTE_CANCELLED", `Compute lease cancelled: ${leaseId}`) }
}
