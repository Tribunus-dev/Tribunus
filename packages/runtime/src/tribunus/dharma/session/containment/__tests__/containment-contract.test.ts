/**
 * Tests for Dharma Containment — Contract Tests
 *
 * Verifies the structural contracts and basic behaviour of the
 * containment launcher, probe, and recovery modules. These tests
 * do NOT exercise real OS-level containment — they validate that
 * the interfaces are correctly wired and produce expected shapes.
 */

import { describe, it, expect } from "bun:test"
import { ContainedProcessLauncher } from "../containment-launcher"
import type { ContainmentLauncherConfig } from "../containment-launcher"
import {
  detectCapabilities,
  getContainmentPlatform,
} from "../containment-probe"
import {
  createRecoveryState,
  canRecover,
  requiresSessionTermination,
} from "../containment-recovery"
import type { ContainmentBackendKind, ContainmentViolation } from "../containment-types"

// ── ContainedProcessLauncher ───────────────────────────────────────────────

describe("ContainedProcessLauncher", () => {
  it("creates with backend config", () => {
    const config: ContainmentLauncherConfig = { backend: "none" }
    const launcher = new ContainedProcessLauncher(config)
    expect(launcher).toBeInstanceOf(ContainedProcessLauncher)
  })

  it("checkAvailability returns result for none backend", async () => {
    const config: ContainmentLauncherConfig = { backend: "none" }
    const launcher = new ContainedProcessLauncher(config)
    const result = await launcher.checkAvailability()
    expect(result).toHaveProperty("available")
    expect(typeof result.available).toBe("boolean")
    // "none" is always available
    expect(result.available).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("checkAvailability returns false for unsupported backend", async () => {
    const config: ContainmentLauncherConfig = { backend: "macos_app_sandbox" }
    const launcher = new ContainedProcessLauncher(config)
    const result = await launcher.checkAvailability()
    expect(result).toHaveProperty("available")
    expect(result).toHaveProperty("reason")
    // macos_app_sandbox is never available outside App Store builds
    expect(result.available).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it("terminate throws for unknown executionId", async () => {
    const config: ContainmentLauncherConfig = { backend: "none" }
    const launcher = new ContainedProcessLauncher(config)
    expect(launcher.terminate("nonexistent-id", false)).rejects.toThrow()
  })
})

// ── Capability Probe ───────────────────────────────────────────────────────

describe("containment probe", () => {
  it("detectCapabilities returns entries for current platform", async () => {
    const caps = await detectCapabilities()
    expect(Array.isArray(caps)).toBe(true)
    expect(caps.length).toBeGreaterThanOrEqual(1)

    // Every capability has the required shape
    for (const cap of caps) {
      expect(cap).toHaveProperty("backend")
      expect(cap).toHaveProperty("available")
      expect(cap).toHaveProperty("version")
      expect(cap).toHaveProperty("supportedFeatures")
      expect(cap).toHaveProperty("unsupportedFeatures")
      expect(cap).toHaveProperty("deprecationWarning")
      expect(Array.isArray(cap.supportedFeatures)).toBe(true)
      expect(Array.isArray(cap.unsupportedFeatures)).toBe(true)
    }

    // The "none" fallback is always present
    const noneCap = caps.find(c => c.backend === "none")
    expect(noneCap).toBeDefined()
    expect(noneCap!.available).toBe(true)
  })

  it("getContainmentPlatform returns a valid backend kind", () => {
    const validKinds: ContainmentBackendKind[] = [
      "macos_seatbelt",
      "macos_app_sandbox",
      "linux_namespaces",
      "none",
    ]
    const platform = getContainmentPlatform()
    expect(validKinds).toContain(platform)
  })
})

// ── Recovery State ─────────────────────────────────────────────────────────

describe("containment recovery", () => {
  it("createRecoveryState creates valid state", () => {
    const state = createRecoveryState("exec-1", "session-1", "Process crashed")

    expect(state).toHaveProperty("executionId", "exec-1")
    expect(state).toHaveProperty("sessionId", "session-1")
    expect(state.backendFailed).toBe(false)
    expect(Array.isArray(state.violations)).toBe(true)
    expect(state.violations.length).toBeGreaterThanOrEqual(1)
    expect(state.processTreeTerminated).toBe(false)
    expect(state.mutableStateCleaned).toBe(false)

    // Violation references the execution
    const v = state.violations[0]!
    expect(v.executionId).toBe("exec-1")
    expect(v.sessionId).toBe("session-1")
    expect(v.kind).toBe("syscall_denied")
    expect(v.severity).toBe("warning")
    expect(v.details).toBe("Process crashed")
  })

  it("createRecoveryState marks backend-related errors as critical", () => {
    const state = createRecoveryState("exec-2", "session-1", "Backend unavailable: sandbox-exec not found")
    expect(state.backendFailed).toBe(true)
    expect(state.violations[0]!.severity).toBe("critical")
  })

  it("canRecover returns true for clean state", () => {
    const state = createRecoveryState("exec-1", "session-1", "Minor failure")
    // Default state after createRecoveryState: no backend failure,
    // warning-level violation (not critical)
    expect(canRecover(state)).toBe(true)
  })

  it("canRecover returns false when backend failed and process not terminated", () => {
    const state = createRecoveryState("exec-1", "session-1", "Backend unavailable")
    // Default: backendFailed=true, processTreeTerminated=false
    expect(canRecover(state)).toBe(false)
  })

  it("requiresSessionTermination returns false for minor violations", () => {
    const state = createRecoveryState("exec-1", "session-1", "Minor IPC violation")
    // Default: warning severity, not critical
    state.processTreeTerminated = true
    expect(requiresSessionTermination(state)).toBe(false)
  })

  it("requiresSessionTermination returns true for critical violations", () => {
    const state = createRecoveryState("exec-1", "session-1", "Backend unavailable")
    // Default: backendFailed=true, processTreeTerminated=false, critical severity
    expect(requiresSessionTermination(state)).toBe(true)
  })

  it("requiresSessionTermination returns true when process tree not terminated", () => {
    const state = createRecoveryState("exec-1", "session-1", "Minor failure")
    // processTreeTerminated is false by default
    expect(requiresSessionTermination(state)).toBe(true)
  })
})
