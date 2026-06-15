import { describe, test, expect } from "bun:test"
import { createOperationGraph } from "../src/operation-graph.js"

describe("OperationGraph", () => {
  test("creates an empty graph", () => {
    const graph = createOperationGraph()
    expect(graph.ops).toEqual([])
    expect(graph.validate()).toBe(false) // Empty graph is invalid per current validate() implementation
  })

  test("addOp returns an ID and adds to ops", () => {
    const graph = createOperationGraph()
    const opId = graph.addOp({
      opType: "add",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: []
    })

    expect(opId).toBeString()
    expect(opId.startsWith("op_")).toBe(true)

    expect(graph.ops.length).toBe(1)
    expect(graph.ops[0].opId).toBe(opId)
    expect(graph.ops[0].opType).toBe("add")
  })

  test("topologicalOrder with a simple linear DAG", () => {
    const graph = createOperationGraph()

    const op1 = graph.addOp({
      opType: "op1",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: []
    })

    const op2 = graph.addOp({
      opType: "op2",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [op1]
    })

    const op3 = graph.addOp({
      opType: "op3",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [op2]
    })

    const order = graph.topologicalOrder()
    expect(order).toEqual([op1, op2, op3])
  })

  test("topologicalOrder with a complex DAG", () => {
    const graph = createOperationGraph()

    // A -> B -> D
    // A -> C -> D
    const opA = graph.addOp({
      opType: "A",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: []
    })

    const opB = graph.addOp({
      opType: "B",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [opA]
    })

    const opC = graph.addOp({
      opType: "C",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [opA]
    })

    const opD = graph.addOp({
      opType: "D",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [opB, opC]
    })

    const order = graph.topologicalOrder()

    // Order should start with A and end with D. B and C can be in any order.
    expect(order[0]).toBe(opA)
    expect(order[order.length - 1]).toBe(opD)
    expect(order).toContain(opB)
    expect(order).toContain(opC)
  })

  test("validate returns true on a valid graph", () => {
    const graph = createOperationGraph()
    const op1 = graph.addOp({
      opType: "op1",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: []
    })
    graph.addOp({
      opType: "op2",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [op1]
    })

    expect(graph.validate()).toBe(true)
  })

  test("validate returns false on graph with missing dependencies", () => {
    const graph = createOperationGraph()
    graph.addOp({
      opType: "op1",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: ["missing_op_id"]
    })

    expect(graph.validate()).toBe(false)
  })

  test("validate returns false on graph with a circular dependency", () => {
    const graph = createOperationGraph()

    const op1 = graph.addOp({
      opType: "op1",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: []
    })

    const op2 = graph.addOp({
      opType: "op2",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [op1]
    })

    // Mutate the dependencies directly to introduce a cycle.
    // The addOp API sequentially assigns IDs, so we can't create cycles without mutating.
    const op1Ref = graph.ops.find(o => o.opId === op1)
    if (op1Ref) {
      // Create a cycle: op1 -> op2 -> op1
      // @ts-expect-error mutating readonly property for testing
      op1Ref.dependencies.push(op2)
    }

    expect(graph.validate()).toBe(false)
  })

  test("topologicalOrder caching behavior", () => {
    const graph = createOperationGraph()

    const op1 = graph.addOp({
      opType: "op1",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: []
    })

    const order1 = graph.topologicalOrder()
    const order2 = graph.topologicalOrder()

    // Should be exactly the same array instance due to caching
    expect(order1).toBe(order2)

    const op2 = graph.addOp({
      opType: "op2",
      inputs: [],
      outputs: [],
      attributes: {},
      dependencies: [op1]
    })

    const order3 = graph.topologicalOrder()
    // Should be a new array instance
    expect(order3).not.toBe(order1)
    expect(order3).toEqual([op1, op2])
  })
})
