/**
 * Prism Heterogeneous Memory Fabric — Error Classes
 */

export class FabricError extends Error {
  public readonly code: string

  constructor(message: string, code = "FABRIC_ERROR") {
    super(message)
    this.name = "FabricError"
    this.code = code
  }
}

export class TopologyError extends FabricError {
  constructor(message: string, code = "TOPOLOGY_ERROR") {
    super(message, code)
    this.name = "TopologyError"
  }
}

export class PlacementError extends FabricError {
  constructor(message: string, code = "PLACEMENT_ERROR") {
    super(message, code)
    this.name = "PlacementError"
  }
}

export class BudgetError extends FabricError {
  constructor(message: string, code = "BUDGET_ERROR") {
    super(message, code)
    this.name = "BudgetError"
  }
}

export class AdapterError extends FabricError {
  public readonly adapterKind: string

  constructor(message: string, adapterKind: string, code = "ADAPTER_ERROR") {
    super(message, code)
    this.name = "AdapterError"
    this.adapterKind = adapterKind
  }
}

export class TransportEdgeError extends FabricError {
  constructor(message: string, code = "TRANSPORT_EDGE_ERROR") {
    super(message, code)
    this.name = "TransportEdgeError"
  }
}

export class NpuAdmissionError extends FabricError {
  constructor(message: string, code = "NPU_ADMISSION_ERROR") {
    super(message, code)
    this.name = "NpuAdmissionError"
  }
}

export class FabricHandoffError extends FabricError {
  constructor(message: string, code = "FABRIC_HANDOFF_ERROR") {
    super(message, code)
    this.name = "FabricHandoffError"
  }
}

export class BenchmarkError extends FabricError {
  constructor(message: string, code = "BENCHMARK_ERROR") {
    super(message, code)
    this.name = "BenchmarkError"
  }
}

export class DharmaPolicyError extends FabricError {
  constructor(message: string, code = "DHARMA_POLICY_ERROR") {
    super(message, code)
    this.name = "DharmaPolicyError"
  }
}
