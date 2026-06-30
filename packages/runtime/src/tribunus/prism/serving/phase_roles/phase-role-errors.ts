export class PhaseRoleError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "PhaseRoleError"; this.code = code }
}
export class PhaseAdmissionError extends PhaseRoleError {
  constructor(message: string) { super("PHASE_ADMISSION_ERROR", message) }
}
export class SameWorkerInvariantError extends PhaseRoleError {
  constructor() { super("SAME_WORKER_INVARIANT", "Prefill and decode worker must be identical") }
}
export class ExecutionPinError extends PhaseRoleError {
  constructor(message: string) { super("EXECUTION_PIN_ERROR", message) }
}
export class PhaseCapacityError extends PhaseRoleError {
  constructor(message: string) { super("PHASE_CAPACITY_ERROR", message) }
}
export class ForeignKvError extends PhaseRoleError {
  constructor() { super("FOREIGN_KV_ERROR", "KV namespace belongs to a different worker") }
}
export class PhaseDrainError extends PhaseRoleError {
  constructor(message: string) { super("PHASE_DRAIN_ERROR", message) }
}
export class PhaseBudgetError extends PhaseRoleError {
  constructor(message: string) { super("PHASE_BUDGET_ERROR", message) }
}
