/**
 * Dharma OS-Enforced Sandbox — Containment Capability Report
 *
 * Types and builders for release-grade containment capability evidence.
 * Aggregates hostile fixture results, backend availability, and platform
 * sandbox metadata into a single report used to attest containment posture.
 */

import type { ContainmentBackendKind } from "./containment-types"

// ── Platform & Packaging Identifiers -----------------------------------------

export type ContainmentPlatform = "macos" | "linux"

export type ContainmentPackagingMode =
  | "signed_app_bundle"
  | "app_sandbox"
  | "hardened_runtime"
  | "package_manager"
  | "appimage"

// ── Hostile Fixture Result ---------------------------------------------------

export interface HostileFixtureResult {
  fixtureName: string
  description: string
  attemptedAt: string
  outcome: "blocked" | "failed_open" | "error"
  detail: string
}

// ── Release-Grade Capability Report ------------------------------------------

export interface ContainmentCapabilityReport {
  platform: ContainmentPlatform
  packagingMode: ContainmentPackagingMode
  entitlements: string[]
  sandboxEnabled: boolean
  hardenedRuntimeEnabled: boolean
  containmentBackends: ContainmentBackendKind[]
  availableBackends: string[]
  unavailableBackends: string[]
  hostileFixtureResults: HostileFixtureResult[]
  passed: boolean
  passedAt: string | null
}

// ── Default Packaging Mode Per Platform --------------------------------------

function defaultPackagingMode(platform: ContainmentPlatform): ContainmentPackagingMode {
  switch (platform) {
    case "macos":
      return "hardened_runtime"
    case "linux":
      return "appimage"
  }
}

// ── Report Builder -----------------------------------------------------------

/**
 * Create a new containment capability report for the given platform.
 * Initialises with no fixture results, empty entitlement lists, and
 * sets passed to false.
 */
export function createContainmentReport(
  platform: ContainmentPlatform,
): ContainmentCapabilityReport {
  return {
    platform,
    packagingMode: defaultPackagingMode(platform),
    entitlements: [],
    sandboxEnabled: false,
    hardenedRuntimeEnabled: false,
    containmentBackends: [],
    availableBackends: [],
    unavailableBackends: [],
    hostileFixtureResults: [],
    passed: false,
    passedAt: null,
  }
}

/**
 * Append a hostile fixture result to an existing report and re-evaluate
 * the overall pass/fail status. Returns a new report object (immutable).
 */
export function addFixtureResult(
  report: ContainmentCapabilityReport,
  result: HostileFixtureResult,
): ContainmentCapabilityReport {
  const hostileFixtureResults = [...report.hostileFixtureResults, result]
  const passed = hostileFixtureResults.every(
    (r) => r.outcome === "blocked",
  )
  const passedAt = passed ? new Date().toISOString() : null

  return {
    ...report,
    hostileFixtureResults,
    passed,
    passedAt,
  }
}

// ── Query Functions ----------------------------------------------------------

/**
 * Returns true when every hostile fixture outcome is "blocked", indicating
 * the release containment posture is sufficient for production workloads.
 */
export function isContainmentSufficient(report: ContainmentCapabilityReport): boolean {
  return report.passed && report.hostileFixtureResults.length > 0
}

/**
 * Returns true when the named backend appears in the available backends
 * list and the overall containment report has passed.
 */
export function canRunWorkload(
  report: ContainmentCapabilityReport,
  requiredBackend: string,
): boolean {
  return report.availableBackends.includes(requiredBackend) && report.passed
}

/**
 * Returns a copy of the available backend names from the report.
 */
export function getAvailableBackends(
  report: ContainmentCapabilityReport,
): string[] {
  return [...report.availableBackends]
}

/**
 * Returns the subset of hostile fixture results whose outcome is not "blocked",
 * i.e. fixtures that were failed_open or errored.
 */
export function getFailedFixtures(
  report: ContainmentCapabilityReport,
): HostileFixtureResult[] {
  return report.hostileFixtureResults.filter((r) => r.outcome !== "blocked")
}
