/**
 * macOS Seatbelt — Process Tree Revocation Tests
 *
 * Tests the MacOSProcessTree class for correct initialization, record
 * creation, and summary generation. Process signalling tests are
 * environment-dependent and gated behind conditionals.
 */

import { describe, it, expect } from "bun:test"
import { MacOSProcessTree } from "../macos-process-tree"
import type { ContainedProcessTree } from "../../containment-types"

// ── Tests ───────────────────────────────────────────────────────────────────

describe("MacOSProcessTree", () => {
  it("creates with executionId and rootPid", () => {
    const tree = new MacOSProcessTree("exec-1", 42)

    expect(tree).toBeDefined()
    expect(tree).toBeInstanceOf(MacOSProcessTree)
  })

  it("createRecord returns a valid ContainedProcessTree", () => {
    const tree = new MacOSProcessTree("exec-1", 42)
    const record = tree.createRecord()

    // Verify it conforms to ContainedProcessTree interface
    expect(record).toHaveProperty("executionId", "exec-1")
    expect(record).toHaveProperty("rootPid", 42)
    expect(record).toHaveProperty("containmentId")
    expect(record.containmentId).toContain("macos-ptree-")
    expect(record.containmentId).toContain("exec-1")
    expect(record).toHaveProperty("processGroupId")
    expect(record.processGroupId).toBe("-42")
    expect(record).toHaveProperty("startedAt")
    expect(typeof record.startedAt).toBe("string")
    expect(record.startedAt.length).toBeGreaterThan(0)
    expect(record).toHaveProperty("childCount", 0)
    expect(record).toHaveProperty("state", "running")
    expect(record).toHaveProperty("leafPids")
    expect(Array.isArray(record.leafPids)).toBe(true)
    expect(record.leafPids).toHaveLength(0)
  })

  it("createRecord returns correct type for ProcessTreeState field", () => {
    const tree = new MacOSProcessTree("exec-2", 100)
    const record = tree.createRecord()

    // state must be one of the ProcessTreeState values
    const validStates: readonly string[] = ["running", "draining", "terminated", "orphaned"]
    expect(validStates).toContain(record.state)
  })

  it("createRecord executionId matches constructor arg", () => {
    const tree = new MacOSProcessTree("unique-exec-id", 1)
    const record = tree.createRecord()

    expect(record.executionId).toBe("unique-exec-id")
  })

  it("createRecord rootPid matches constructor arg", () => {
    const tree = new MacOSProcessTree("exec", 9999)
    const record = tree.createRecord()

    expect(record.rootPid).toBe(9999)
  })

  it("createRecord processGroupId is negated rootPid string", () => {
    const tree = new MacOSProcessTree("exec", 77)
    const record = tree.createRecord()

    expect(record.processGroupId).toBe("-77")
  })

  it("getSummary returns non-empty string", async () => {
    const tree = new MacOSProcessTree("exec-3", process.pid)
    const summary = await tree.getSummary()

    expect(typeof summary).toBe("string")
    expect(summary.length).toBeGreaterThan(0)
    // Summary format: root:<pid>,children:<count>,state:<state>
    expect(summary).toMatch(/^root:\d+,children:\d+,state:\w+$/)
  })

  it("getSummary for current process returns valid state", async () => {
    const tree = new MacOSProcessTree("exec-4", process.pid)
    const state = await tree.getState()

    // The current process should be "running"
    expect(state).toBe("running")
  })

  it("getSummary for non-existent PID returns terminated state", async () => {
    // PID 1 typically exists on macOS (launchd), but PID 99999999 almost certainly doesn't
    const tree = new MacOSProcessTree("exec-5", 99999999)
    const state = await tree.getState()

    expect(state).toBe("terminated")
  })

  it("getChildPids for current process returns array", async () => {
    const tree = new MacOSProcessTree("exec-6", process.pid)
    const children = await tree.getChildPids()

    expect(Array.isArray(children)).toBe(true)
    // All entries should be positive integers
    for (const pid of children) {
      expect(typeof pid).toBe("number")
      expect(pid).toBeGreaterThan(0)
      expect(Number.isInteger(pid)).toBe(true)
    }
  })
})
