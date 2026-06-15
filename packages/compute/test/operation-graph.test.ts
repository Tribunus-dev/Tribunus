import { describe, test, expect } from "bun:test"
import { hasCycle, type ComputeOp } from "../src/operation-graph.js"

function createDummyOp(opId: string, dependencies: string[]): ComputeOp {
  return {
    opId,
    opType: "dummy",
    inputs: [],
    outputs: [],
    attributes: {},
    dependencies,
  }
}

describe("hasCycle", () => {
  test("returns false for an empty graph", () => {
    const ops = new Map<string, ComputeOp>()
    expect(hasCycle(ops)).toBe(false)
  })

  test("returns false for a graph with no dependencies", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", []))
    ops.set("B", createDummyOp("B", []))
    expect(hasCycle(ops)).toBe(false)
  })

  test("returns false for a linear dependency graph", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", []))
    ops.set("B", createDummyOp("B", ["A"]))
    ops.set("C", createDummyOp("C", ["B"]))
    expect(hasCycle(ops)).toBe(false)
  })

  test("returns false for a branching graph without cycles", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", []))
    ops.set("B", createDummyOp("B", ["A"]))
    ops.set("C", createDummyOp("C", ["A"]))
    ops.set("D", createDummyOp("D", ["B", "C"]))
    expect(hasCycle(ops)).toBe(false)
  })

  test("returns true for a self loop", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", ["A"]))
    expect(hasCycle(ops)).toBe(true)
  })

  test("returns true for a simple cycle (A -> B -> A)", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", ["B"]))
    ops.set("B", createDummyOp("B", ["A"]))
    expect(hasCycle(ops)).toBe(true)
  })

  test("returns true for a longer cycle (A -> B -> C -> A)", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", ["C"])) // A depends on C
    ops.set("B", createDummyOp("B", ["A"])) // B depends on A
    ops.set("C", createDummyOp("C", ["B"])) // C depends on B
    expect(hasCycle(ops)).toBe(true)
  })

  test("returns true for a cycle with disconnected components", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("X", createDummyOp("X", []))
    ops.set("Y", createDummyOp("Y", ["X"]))

    ops.set("A", createDummyOp("A", ["B"]))
    ops.set("B", createDummyOp("B", ["A"]))
    expect(hasCycle(ops)).toBe(true)
  })

  test("handles missing dependencies gracefully (no cycle)", () => {
    const ops = new Map<string, ComputeOp>()
    ops.set("A", createDummyOp("A", ["Z"])) // Z is missing
    expect(hasCycle(ops)).toBe(false)
  })
})
