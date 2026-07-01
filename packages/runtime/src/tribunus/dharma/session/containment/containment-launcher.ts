/**
 * Dharma OS-Enforced Sandbox — Contained Process Launcher
 *
 * Platform-neutral entry point for launching a contained process.
 * Orchestrates the containment flow: compiles profile, selects backend,
 * and returns an execution receipt. OS-level execution is delegated to
 * platform-specific backends.
 */

import { randomUUID } from "node:crypto"
import type {
  ContainedExecutionRequest,
  ContainedExecutionReceipt,
  ContainmentBackendKind,
  ContainmentProfile,
  ContainmentViolationEvent,
} from "./containment-types"
import { compileContainmentProfile, computePolicyDigest } from "./containment-policy"
import { createViolation, isEmergencyViolation } from "./containment-audit"
import { BackendUnavailableError, TerminationError } from "./containment-errors"
import { detectCapabilities } from "./containment-probe"

// ── Launcher Config ────────────────────────────────────────────────────────

export interface ContainmentLauncherConfig {
  /** Backend kind to use for containment. */
  backend: ContainmentBackendKind
}

// ── Running Process Tracker ────────────────────────────────────────────────

interface RunningProcess {
  executionId: string
  request: ContainedExecutionRequest
  profile: ContainmentProfile
  startedAt: string
}

// ── ContainedProcessLauncher ───────────────────────────────────────────────

/**
 * ContainedProcessLauncher is the platform-neutral entry point for
 * launching a contained process. It compiles the containment profile,
 * validates backend availability, and returns an execution receipt.
 *
 * OS-level process execution is delegated to platform backends
 * (macOS Seatbelt / Linux namespaces / etc.) which will be integrated
 * in a subsequent phase.
 */
export class ContainedProcessLauncher {
  private runningProcesses = new Map<string, RunningProcess>()

  constructor(private config: ContainmentLauncherConfig) {}

  /**
   * Launch a contained process. This is the main entry point.
   *
   * 1. Compile containment profile from request
   * 2. Check backend capability
   * 3. Generate platform-specific containment
   * 4. Execute process
   * 5. Return receipt
   */
  async launch(req: ContainedExecutionRequest): Promise<ContainedExecutionReceipt> {
    // 1 — Compile containment profile
    const profile = compileContainmentProfile(req, this.config.backend)

    // 2 — Check backend availability
    const availability = await this.checkAvailability()
    if (!availability.available) {
      throw new BackendUnavailableError(
        this.config.backend,
        availability.reason ?? "Backend not available on this platform",
      )
    }

    // Verify capabilities support this profile
    const capabilities = await detectCapabilities()
    const backendCap = capabilities.find(c => c.backend === this.config.backend)
    if (backendCap && !backendCap.available) {
      throw new BackendUnavailableError(
        this.config.backend,
        `Backend ${this.config.backend} detected but not available`,
      )
    }

    const startedAt = new Date().toISOString()

    // Track the running process
    this.runningProcesses.set(req.executionId, {
      executionId: req.executionId,
      request: req,
      profile,
      startedAt,
    })

    // 4+5 — Return receipt (platform-specific execution wired later)
    const receipt: ContainedExecutionReceipt = {
      executionId: req.executionId,
      containmentBackend: this.config.backend,
      containmentProfileDigest: profile.profileDigest,
      filesystemPolicyDigest: computePolicyDigest(
        profile.filesystemPolicy as unknown as Record<string, unknown>,
      ),
      networkPolicyDigest: computePolicyDigest(
        profile.networkPolicy as unknown as Record<string, unknown>,
      ),
      resourcePolicyDigest: computePolicyDigest(
        profile.resourceLimits as unknown as Record<string, unknown>,
      ),
      startedAt,
      endedAt: "",
      exitCode: null,
      terminationReason: null,
      violationEvents: [],
      stdoutDigest: null,
      stderrDigest: null,
      processTreeSummary: `rootPid:null;state:pending;backend:${this.config.backend}`,
    }

    return receipt
  }

  /**
   * Terminate a running contained process tree.
   *
   * @param executionId - The execution ID of the process to terminate.
   * @param emergency - When true, performs an emergency (force-kill) termination.
   */
  async terminate(executionId: string, _emergency: boolean): Promise<void> {
    const proc = this.runningProcesses.get(executionId)
    if (!proc) {
      throw new TerminationError(`No running process with executionId: ${executionId}`)
    }

    this.runningProcesses.delete(executionId)
  }

  /**
   * Check if the configured backend is available on the current platform.
   */
  async checkAvailability(): Promise<{ available: boolean; reason: string | null }> {
    const capabilities = await detectCapabilities()
    const cap = capabilities.find(c => c.backend === this.config.backend)

    if (!cap) {
      return {
        available: false,
        reason: `No capability descriptor found for backend: ${this.config.backend}`,
      }
    }

    if (!cap.available) {
      return {
        available: false,
        reason: cap.deprecationWarning ?? `Backend ${this.config.backend} is not available`,
      }
    }

    return { available: true, reason: null }
  }
}
