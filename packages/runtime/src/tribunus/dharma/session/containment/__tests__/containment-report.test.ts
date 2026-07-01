/**
 * Tests for Dharma Containment — Containment Capability Report
 *
 * Validates the report builder, fixture addition, sufficiency gates,
 * workload eligibility, and backend listing helpers. These tests
 * exercise only pure data transformations — no real OS containment.
 */

import { describe, it, expect } from "bun:test"
import {
  createContainmentReport,
  addFixtureResult,
  isContainmentSufficient,
  canRunWorkload,
  getAvailableBackends,
  getFailedFixtures,
} from "../containment-report"
import type {
  ContainmentCapabilityReport,
  HostileFixtureResult,
} from "../containment-report"

// ── Helpers ─────────────────────────────────────────────────────────────────

const BLOCKED_FIXTURE: HostileFixtureResult = {
  fixtureName: "secret-read",
  description: "attempt to read host SSH keys",
  attemptedAt: "2026-07-01T00:00:00.000Z",
  outcome: "blocked",
  detail: "sandbox-exec denied the read(2) call with EPERM",
}

const FAILED_OPEN_FIXTURE: HostileFixtureResult = {
  fixtureName: "secret-read",
  description: "attempt to read host SSH keys",
  attemptedAt: "2026-07-01T00:00:00.000Z",
  outcome: "failed_open",
  detail: "read completed without sandbox intervention",
}

const ERROR_FIXTURE: HostileFixtureResult = {
  fixtureName: "fork-bomb",
  description: "attempt to exhaust process table",
  attemptedAt: "2026-07-01T00:00:00.000Z",
  outcome: "error",
  detail: "sandbox binary not found on PATH",
}

// ── Report Creation ─────────────────────────────────────────────────────────

describe("createContainmentReport", () => {
  it("creates a fresh macos report with default packaging", () => {
    const report = createContainmentReport("macos")
    expect(report.platform).toBe("macos")
    expect(report.packagingMode).toBe("hardened_runtime")
    expect(report.passed).toBe(false)
    expect(report.passedAt).toBeNull()
    expect(report.hostileFixtureResults).toEqual([])
    expect(report.entitlements).toEqual([])
    expect(report.containmentBackends).toEqual([])
    expect(report.availableBackends).toEqual([])
    expect(report.unavailableBackends).toEqual([])
  })

  it("creates a fresh linux report with default packaging", () => {
    const report = createContainmentReport("linux")
    expect(report.platform).toBe("linux")
    expect(report.packagingMode).toBe("appimage")
    expect(report.passed).toBe(false)
    expect(report.passedAt).toBeNull()
  })
})

// ── Fixture Addition ───────────────────────────────────────────────────────

describe("addFixtureResult", () => {
  it("adds a blocked fixture result and updates passed", () => {
    const report = createContainmentReport("macos")
    const updated = addFixtureResult(report, BLOCKED_FIXTURE)

    expect(updated.hostileFixtureResults).toHaveLength(1)
    expect(updated.hostileFixtureResults[0].outcome).toBe("blocked")
    expect(updated.passed).toBe(true)
    expect(updated.passedAt).not.toBeNull()
  })

  it("marks passed false when a fixture fails open", () => {
    const report = createContainmentReport("macos")
    const updated = addFixtureResult(report, FAILED_OPEN_FIXTURE)

    expect(updated.hostileFixtureResults).toHaveLength(1)
    expect(updated.passed).toBe(false)
    expect(updated.passedAt).toBeNull()
  })

  it("marks passed false when a fixture errors", () => {
    const report = createContainmentReport("linux")
    const updated = addFixtureResult(report, ERROR_FIXTURE)

    expect(updated.hostileFixtureResults).toHaveLength(1)
    expect(updated.passed).toBe(false)
    expect(updated.passedAt).toBeNull()
  })

  it("requires ALL fixture results to be blocked for passed", () => {
    const report = createContainmentReport("macos")
    const afterBlocked = addFixtureResult(report, BLOCKED_FIXTURE)
    const afterFailed = addFixtureResult(afterBlocked, FAILED_OPEN_FIXTURE)

    expect(afterFailed.hostileFixtureResults).toHaveLength(2)
    expect(afterFailed.passed).toBe(false)
    expect(afterFailed.passedAt).toBeNull()
  })

  it("preserves existing fields when adding results", () => {
    const report = createContainmentReport("linux")
    report.availableBackends.push("landlock")
    report.containmentBackends.push("linux_namespaces")
    const updated = addFixtureResult(report, BLOCKED_FIXTURE)

    expect(updated.platform).toBe("linux")
    expect(updated.availableBackends).toContain("landlock")
    expect(updated.containmentBackends).toContain("linux_namespaces")
  })

  it("does not mutate the original report", () => {
    const report = createContainmentReport("macos")
    const updated = addFixtureResult(report, BLOCKED_FIXTURE)

    expect(report.hostileFixtureResults).toHaveLength(0)
    expect(report.passed).toBe(false)
    expect(updated.hostileFixtureResults).toHaveLength(1)
  })
})

// ── Sufficiency Gate ───────────────────────────────────────────────────────

describe("isContainmentSufficient", () => {
  it("returns true when all fixtures blocked and results exist", () => {
    const report = addFixtureResult(
      createContainmentReport("macos"),
      BLOCKED_FIXTURE,
    )
    expect(isContainmentSufficient(report)).toBe(true)
  })

  it("returns false when no fixtures have been run", () => {
    const report = createContainmentReport("macos")
    expect(isContainmentSufficient(report)).toBe(false)
  })

  it("returns false when any fixture failed open", () => {
    let report = createContainmentReport("macos")
    report = addFixtureResult(report, BLOCKED_FIXTURE)
    report = addFixtureResult(report, FAILED_OPEN_FIXTURE)
    expect(isContainmentSufficient(report)).toBe(false)
  })

  it("returns false when report passed flag is false", () => {
    const report = { ...createContainmentReport("macos"), passed: false, hostileFixtureResults: [BLOCKED_FIXTURE] }
    expect(isContainmentSufficient(report)).toBe(false)
  })
})

// ── Workload Eligibility ───────────────────────────────────────────────────

describe("canRunWorkload", () => {
  it("returns true when backend is available and report passed", () => {
    const report: ContainmentCapabilityReport = {
      ...createContainmentReport("macos"),
      availableBackends: ["macos_seatbelt", "macos_app_sandbox"],
      passed: true,
      passedAt: "2026-07-01T00:00:00.000Z",
    }
    expect(canRunWorkload(report, "macos_seatbelt")).toBe(true)
  })

  it("returns false when backend is not in available backends", () => {
    const report: ContainmentCapabilityReport = {
      ...createContainmentReport("linux"),
      availableBackends: ["landlock"],
      passed: true,
      passedAt: "2026-07-01T00:00:00.000Z",
    }
    expect(canRunWorkload(report, "seccomp")).toBe(false)
  })

  it("returns false when report has not passed", () => {
    const report: ContainmentCapabilityReport = {
      ...createContainmentReport("macos"),
      availableBackends: ["macos_seatbelt"],
      passed: false,
    }
    expect(canRunWorkload(report, "macos_seatbelt")).toBe(false)
  })
})

// ── Backend Listing ────────────────────────────────────────────────────────

describe("getAvailableBackends", () => {
  it("returns a copy of the available backends array", () => {
    const report: ContainmentCapabilityReport = {
      ...createContainmentReport("linux"),
      availableBackends: ["landlock", "seccomp"],
    }
    const result = getAvailableBackends(report)
    expect(result).toEqual(["landlock", "seccomp"])

    // Verify it's a copy, not the original reference
    result.push("cgroups")
    expect(report.availableBackends).not.toContain("cgroups")
  })

  it("returns empty array when no backends are available", () => {
    const report = createContainmentReport("macos")
    expect(getAvailableBackends(report)).toEqual([])
  })
})

// ── Failed Fixture Tracking ────────────────────────────────────────────────

describe("getFailedFixtures", () => {
  it("returns only non-blocked fixtures", () => {
    let report = createContainmentReport("linux")
    report = addFixtureResult(report, BLOCKED_FIXTURE)
    report = addFixtureResult(report, FAILED_OPEN_FIXTURE)
    report = addFixtureResult(report, ERROR_FIXTURE)

    const failed = getFailedFixtures(report)
    expect(failed).toHaveLength(2)
    expect(failed[0].outcome).toBe("failed_open")
    expect(failed[1].outcome).toBe("error")
  })

  it("returns empty array when all fixtures blocked", () => {
    let report = createContainmentReport("macos")
    report = addFixtureResult(report, BLOCKED_FIXTURE)
    report = addFixtureResult(report, {
      ...BLOCKED_FIXTURE,
      fixtureName: "workspace-escape",
    })

    expect(getFailedFixtures(report)).toEqual([])
  })

  it("returns empty array when no fixtures have been run", () => {
    const report = createContainmentReport("macos")
    expect(getFailedFixtures(report)).toEqual([])
  })
})
