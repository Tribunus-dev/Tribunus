/**
 * Tests for pilot-types.ts — Session creation, constraints, evidence
 */

import { describe, it, expect } from "bun:test"
import {
  createPilotSession,
  getDefaultConstraints,
  isSessionWithinConstraints,
  createEvidenceBundle,
  isPilotSuccessful,
} from "../pilot-types"
import type { PilotSessionConfig, PilotConstraints, PilotEvidenceBundle } from "../pilot-types"

// ── createPilotSession ------------------------------------------------------

describe("createPilotSession", () => {
  it("creates a session with the given identity and type", () => {
    const s = createPilotSession("pilot-001", "bug_reproduction", "Reproduce crash on login")

    expect(s.sessionId).toBe("pilot-001")
    expect(s.sessionType).toBe("bug_reproduction")
    expect(s.title).toBe("Reproduce crash on login")
  })

  it("sets a non-empty createdAt timestamp", () => {
    const s = createPilotSession("pilot-002", "benchmark", "Token throughput")
    expect(s.createdAt).toBeTruthy()
    expect(new Date(s.createdAt).getTime()).toBeGreaterThan(0)
  })

  it("defaults description to empty string", () => {
    const s = createPilotSession("pilot-003", "documentation_repair", "Fix API docs")
    expect(s.description).toBe("")
  })

  it("sets type-appropriate default values for bug_reproduction", () => {
    const s = createPilotSession("pilot-004", "bug_reproduction", "")

    expect(s.maxContributors).toBe(3)
    expect(s.maxComputeBudgetMs).toBe(30_000)
    expect(s.maxDurationMs).toBe(600_000)
    expect(s.requireManualReview).toBeFalse()
    expect(s.requireManualModeration).toBeFalse()
    expect(s.allowedModelDigests).toEqual([])
    expect(s.allowedArtifactDigests).toEqual([])
    expect(s.allowedDisclosureClasses).toEqual([])
  })

  it("sets type-appropriate default values for benchmark", () => {
    const s = createPilotSession("pilot-005", "benchmark", "")

    expect(s.maxContributors).toBe(5)
    expect(s.maxComputeBudgetMs).toBe(120_000)
    expect(s.maxDurationMs).toBe(3_600_000)
    expect(s.requireManualReview).toBeTrue()
  })

  it("sets type-appropriate default values for hardware_bringup", () => {
    const s = createPilotSession("pilot-006", "hardware_bringup", "")

    expect(s.maxContributors).toBe(6)
    expect(s.maxComputeBudgetMs).toBe(600_000)
    expect(s.maxDurationMs).toBe(7_200_000)
    expect(s.requireManualReview).toBeTrue()
    expect(s.requireManualModeration).toBeTrue()
  })

  it("sets type-appropriate default values for documentation_repair", () => {
    const s = createPilotSession("pilot-007", "documentation_repair", "")

    expect(s.maxContributors).toBe(5)
    expect(s.maxComputeBudgetMs).toBe(15_000)
    expect(s.maxDurationMs).toBe(300_000)
    expect(s.requireManualReview).toBeFalse()
  })

  it("sets type-appropriate default values for small_refactor", () => {
    const s = createPilotSession("pilot-008", "small_refactor", "")

    expect(s.maxContributors).toBe(3)
    expect(s.maxComputeBudgetMs).toBe(60_000)
    expect(s.maxDurationMs).toBe(1_800_000)
  })

  it("sets type-appropriate default values for model_backend_compatibility", () => {
    const s = createPilotSession("pilot-009", "model_backend_compatibility", "")

    expect(s.maxContributors).toBe(4)
    expect(s.maxComputeBudgetMs).toBe(300_000)
    expect(s.maxDurationMs).toBe(3_600_000)
    expect(s.requireManualReview).toBeTrue()
    expect(s.requireManualModeration).toBeTrue()
  })
})

// ── getDefaultConstraints ---------------------------------------------------

describe("getDefaultConstraints", () => {
  it("returns a constraints object for the given session type", () => {
    const c = getDefaultConstraints("benchmark")
    expect(c.anonymousProviders).toBe(false)
    expect(c.publicComputeDiscovery).toBe(false)
    expect(c.modelAllowlist).toBe(true)
    expect(c.sourceDisclosureLimit).toBe(false)
    expect(c.computeBudget).toBe(true)
    expect(c.manualReview).toBe(true)
    expect(c.incognitoResults).toBe(true)
    expect(c.maxConcurrentTasks).toBe(4)
  })

  it("returns a copy, not the original object", () => {
    const c1 = getDefaultConstraints("bug_reproduction")
    const c2 = getDefaultConstraints("bug_reproduction")

    expect(c1).not.toBe(c2)
  })

  it("hardware_bringup enables publicComputeDiscovery", () => {
    const c = getDefaultConstraints("hardware_bringup")
    expect(c.publicComputeDiscovery).toBeTrue()
  })

  it("documentation_repair allows anonymous providers", () => {
    const c = getDefaultConstraints("documentation_repair")
    expect(c.anonymousProviders).toBeTrue()
    expect(c.manualReview).toBeFalse()
    expect(c.computeBudget).toBeFalse()
  })

  it("model_backend_compatibility requires manual review", () => {
    const c = getDefaultConstraints("model_backend_compatibility")
    expect(c.manualReview).toBeTrue()
    expect(c.incognitoResults).toBeTrue()
  })

  it("every session type has a defined constraint set", () => {
    const types: Array<Parameters<typeof getDefaultConstraints>[0]> = [
      "bug_reproduction",
      "small_refactor",
      "benchmark",
      "documentation_repair",
      "model_backend_compatibility",
      "hardware_bringup",
    ]

    for (const t of types) {
      const c = getDefaultConstraints(t)
      expect(c.maxConcurrentTasks).toBeGreaterThan(0)
    }
  })
})

// ── isSessionWithinConstraints ----------------------------------------------

describe("isSessionWithinConstraints", () => {
  it("passes when modelAllowlist is false regardless of allowed model digests", () => {
    const config = createPilotSession("s1", "documentation_repair", "")
    const constraints: PilotConstraints = {
      anonymousProviders: false,
      publicComputeDiscovery: false,
      modelAllowlist: false,
      sourceDisclosureLimit: false,
      computeBudget: false,
      manualReview: false,
      incognitoResults: false,
      maxConcurrentTasks: 5,
    }

    const result = isSessionWithinConstraints(config, constraints)
    expect(result.allowed).toBeTrue()
    expect(result.violations).toEqual([])
  })

  it("fails when modelAllowlist requires digests but none provided", () => {
    const config = createPilotSession("s2", "benchmark", "")
    const constraints: PilotConstraints = {
      anonymousProviders: false,
      publicComputeDiscovery: false,
      modelAllowlist: true,
      sourceDisclosureLimit: false,
      computeBudget: false,
      manualReview: false,
      incognitoResults: false,
      maxConcurrentTasks: 4,
    }

    const result = isSessionWithinConstraints(config, constraints)
    expect(result.allowed).toBeFalse()
    expect(result.violations).toContain("modelAllowlist requires at least one allowed model digest")
  })

  it("fails when computeBudget constraint is set but budget is zero", () => {
    const config = createPilotSession("s3", "benchmark", "")
    const modified: PilotSessionConfig = { ...config, maxComputeBudgetMs: 0 }
    const constraints: PilotConstraints = {
      anonymousProviders: false,
      publicComputeDiscovery: false,
      modelAllowlist: false,
      sourceDisclosureLimit: false,
      computeBudget: true,
      manualReview: false,
      incognitoResults: false,
      maxConcurrentTasks: 4,
    }

    const result = isSessionWithinConstraints(modified, constraints)
    expect(result.allowed).toBeFalse()
    expect(result.violations).toContain("computeBudget requires a positive maxComputeBudgetMs")
  })

  it("fails when manualReview constraint is set but config lacks it", () => {
    const config = createPilotSession("s4", "bug_reproduction", "")
    const constraints: PilotConstraints = {
      anonymousProviders: false,
      publicComputeDiscovery: false,
      modelAllowlist: false,
      sourceDisclosureLimit: false,
      computeBudget: false,
      manualReview: true,
      incognitoResults: false,
      maxConcurrentTasks: 2,
    }

    const result = isSessionWithinConstraints(config, constraints)
    expect(result.allowed).toBeFalse()
    expect(result.violations).toContain("manualReview constraint requires requireManualReview=true")
  })

  it("passes when all constraints are satisfied", () => {
    const config: PilotSessionConfig = {
      sessionId: "s5",
      sessionType: "benchmark",
      title: "full pass",
      description: "",
      maxContributors: 5,
      allowedModelDigests: ["sha256:abc"],
      allowedArtifactDigests: [],
      allowedDisclosureClasses: [],
      maxComputeBudgetMs: 120_000,
      maxDurationMs: 3_600_000,
      requireManualReview: true,
      requireManualModeration: false,
      createdAt: new Date().toISOString(),
    }
    const constraints: PilotConstraints = {
      anonymousProviders: false,
      publicComputeDiscovery: false,
      modelAllowlist: true,
      sourceDisclosureLimit: true,
      computeBudget: true,
      manualReview: true,
      incognitoResults: true,
      maxConcurrentTasks: 4,
    }

    const result = isSessionWithinConstraints(config, constraints)
    expect(result.allowed).toBeTrue()
    expect(result.violations).toEqual([])
  })

  it("reports multiple violations at once", () => {
    const config = createPilotSession("s6", "bug_reproduction", "")
    const constraints: PilotConstraints = {
      anonymousProviders: false,
      publicComputeDiscovery: false,
      modelAllowlist: true,
      sourceDisclosureLimit: false,
      computeBudget: true,
      manualReview: true,
      incognitoResults: false,
      maxConcurrentTasks: 2,
    }

    const result = isSessionWithinConstraints(config, constraints)
    expect(result.allowed).toBeFalse()
    expect(result.violations.length).toBeGreaterThanOrEqual(2)
  })
})

// ── createEvidenceBundle ----------------------------------------------------

describe("createEvidenceBundle", () => {
  it("returns a bundle with the given session identity", () => {
    const b = createEvidenceBundle("pilot-001", "bug_reproduction")
    expect(b.sessionId).toBe("pilot-001")
    expect(b.sessionType).toBe("bug_reproduction")
  })

  it("initialises all numeric fields to zero", () => {
    const b = createEvidenceBundle("pilot-002", "benchmark")

    expect(b.contributorCount).toBe(0)
    expect(b.completionRate).toBe(0)
    expect(b.acceptedResultCount).toBe(0)
    expect(b.computeLeaseCompletionRate).toBe(0)
    expect(b.containmentIncidents).toBe(0)
    expect(b.recoveryEvents).toBe(0)
    expect(b.receiptValidationFailures).toBe(0)
    expect(b.totalDurationMs).toBe(0)
    expect(b.timeToFirstResultMs).toBe(0)
  })
})

// ── isPilotSuccessful -------------------------------------------------------

describe("isPilotSuccessful", () => {
  function makeBundle(overrides?: Partial<PilotEvidenceBundle>): PilotEvidenceBundle {
    return {
      sessionId: "pilot-001",
      sessionType: "bug_reproduction",
      contributorCount: 2,
      completionRate: 1,
      acceptedResultCount: 1,
      computeLeaseCompletionRate: 1,
      containmentIncidents: 0,
      recoveryEvents: 0,
      receiptValidationFailures: 0,
      totalDurationMs: 45_000,
      timeToFirstResultMs: 12_000,
      ...overrides,
    }
  }

  it("returns true when all criteria are met", () => {
    expect(isPilotSuccessful(makeBundle())).toBeTrue()
  })

  it("returns false when acceptedResultCount is zero", () => {
    expect(isPilotSuccessful(makeBundle({ acceptedResultCount: 0 }))).toBeFalse()
  })

  it("returns false when completionRate is below 0.7", () => {
    expect(isPilotSuccessful(makeBundle({ completionRate: 0.5 }))).toBeFalse()
  })

  it("returns true when completionRate is exactly 0.7", () => {
    expect(isPilotSuccessful(makeBundle({ completionRate: 0.7 }))).toBeTrue()
  })

  it("returns false when computeLeaseCompletionRate is below 0.7", () => {
    expect(isPilotSuccessful(makeBundle({ computeLeaseCompletionRate: 0.3 }))).toBeFalse()
  })

  it("returns false when there are containment incidents", () => {
    expect(isPilotSuccessful(makeBundle({ containmentIncidents: 1 }))).toBeFalse()
  })

  it("returns false when receiptValidationFailures is 3 or more", () => {
    expect(isPilotSuccessful(makeBundle({ receiptValidationFailures: 3 }))).toBeFalse()
    expect(isPilotSuccessful(makeBundle({ receiptValidationFailures: 5 }))).toBeFalse()
  })

  it("returns true when receiptValidationFailures is less than 3", () => {
    expect(isPilotSuccessful(makeBundle({ receiptValidationFailures: 2 }))).toBeTrue()
  })
})
