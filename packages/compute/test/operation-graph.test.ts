import { describe, test, expect } from "bun:test"
import { createOperationGraph } from "../src/operation-graph.js"

// Helper to create a minimal valid op for testing topological sort
const createTestOp = (opType: string, dependencies: string[] = []) => ({
  opType,
  inputs: [],
  outputs: [],
  attributes: {},
  dependencies,
})

describe("OperationGraph topologicalOrder (kahnTopologicalSort)", () => {
  test("empty graph returns empty array", () => {
    const graph = createOperationGraph()
    expect(graph.topologicalOrder()).toEqual([])
  })

  test("single node graph returns single element array", () => {
    const graph = createOperationGraph()
    const opId = graph.addOp(createTestOp("test"))
    expect(graph.topologicalOrder()).toEqual([opId])
  })

  test("linear dependencies return in correct order", () => {
    const graph = createOperationGraph()
    const a = graph.addOp(createTestOp("A"))
    const b = graph.addOp(createTestOp("B", [a]))
    const c = graph.addOp(createTestOp("C", [b]))

    const order = graph.topologicalOrder()
    expect(order).toEqual([a, b, c])
  })

  test("independent nodes are all returned", () => {
    const graph = createOperationGraph()
    const a = graph.addOp(createTestOp("A"))
    const b = graph.addOp(createTestOp("B"))
    const c = graph.addOp(createTestOp("C"))

    const order = graph.topologicalOrder()
    expect(order).toHaveLength(3)
    expect(order.includes(a)).toBe(true)
    expect(order.includes(b)).toBe(true)
    expect(order.includes(c)).toBe(true)
  })

  test("diamond dependencies resolve correctly", () => {
    const graph = createOperationGraph()
    const a = graph.addOp(createTestOp("A"))
    const b = graph.addOp(createTestOp("B", [a]))
    const c = graph.addOp(createTestOp("C", [a]))
    const d = graph.addOp(createTestOp("D", [b, c]))

    const order = graph.topologicalOrder()

    expect(order).toHaveLength(4)
    expect(order[0]).toBe(a)
    expect(order[3]).toBe(d)

    // b and c can be in any order, but must be between a and d
    const bcSlice = order.slice(1, 3)
    expect(bcSlice.includes(b)).toBe(true)
    expect(bcSlice.includes(c)).toBe(true)
  })

  test("disconnected sub-graphs resolve correctly", () => {
    const graph = createOperationGraph()
    // Sub-graph 1: A -> B
    const a = graph.addOp(createTestOp("A"))
    const b = graph.addOp(createTestOp("B", [a]))

    // Sub-graph 2: C -> D
    const c = graph.addOp(createTestOp("C"))
    const d = graph.addOp(createTestOp("D", [c]))

    const order = graph.topologicalOrder()

    expect(order).toHaveLength(4)

    // A must come before B
    expect(order.indexOf(a)).toBeLessThan(order.indexOf(b))

    // C must come before D
    expect(order.indexOf(c)).toBeLessThan(order.indexOf(d))
  })
})
