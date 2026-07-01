/**
 * Dharma Local Prism Compute Lease — Budget Computation
 *
 * Budget computation, enforcement, and defaults for compute lease execution.
 */

import type { ComputeBudget, ComputeImagePolicy, LocalPrismComputeLease } from "./compute-types.ts"

// ── Defaults ----------------------------------------------------------------

export function getDefaultComputeBudget(): ComputeBudget {
  return {
    maximumRuntimeSeconds: 300,
    maximumPrefillMs: 30_000,
    maximumDecodeMs: 120_000,
    maximumTokens: 8192,
    maximumInputTokens: 4096,
    maximumOutputTokens: 4096,
    maximumMemoryBytes: 2 * 1024 * 1024 * 1024,
    maximumGpuTimeMs: null,
    maximumCpuTimeMs: null,
    maximumOutputBytes: 1 * 1024 * 1024,
    maximumCompileTimeMs: 60_000,
  }
}

// ── Effective Budget --------------------------------------------------------

/**
 * Compute the effective budget for a lease by merging:
 * 1. Host-level defaults (fallback)
 * 2. Host overrides (Partial<ComputeBudget> from system config)
 * 3. ComputeImage policy limits
 * 4. Lease request limits
 *
 * Precedence (higher index wins): lease request > policy > host override > default
 */
export function computeEffectiveBudget(
  lease: LocalPrismComputeLease,
  policy: ComputeImagePolicy,
  hostBudget: Partial<ComputeBudget>,
): ComputeBudget {
  const defaults = getDefaultComputeBudget()

  const merged: ComputeBudget = {
    maximumRuntimeSeconds: hostBudget.maximumRuntimeSeconds ?? defaults.maximumRuntimeSeconds,
    maximumPrefillMs: hostBudget.maximumPrefillMs ?? defaults.maximumPrefillMs,
    maximumDecodeMs: hostBudget.maximumDecodeMs ?? defaults.maximumDecodeMs,
    maximumTokens: hostBudget.maximumTokens ?? defaults.maximumTokens,
    maximumInputTokens: hostBudget.maximumInputTokens ?? defaults.maximumInputTokens,
    maximumOutputTokens: hostBudget.maximumOutputTokens ?? defaults.maximumOutputTokens,
    maximumMemoryBytes: hostBudget.maximumMemoryBytes ?? defaults.maximumMemoryBytes,
    maximumGpuTimeMs: hostBudget.maximumGpuTimeMs ?? defaults.maximumGpuTimeMs,
    maximumCpuTimeMs: hostBudget.maximumCpuTimeMs ?? defaults.maximumCpuTimeMs,
    maximumOutputBytes: hostBudget.maximumOutputBytes ?? defaults.maximumOutputBytes,
    maximumCompileTimeMs: hostBudget.maximumCompileTimeMs ?? defaults.maximumCompileTimeMs,
  }

  // Policy tightens compile time
  if (policy.maxCompileTimeMs < merged.maximumCompileTimeMs) {
    merged.maximumCompileTimeMs = policy.maxCompileTimeMs
  }

  // Lease request limits take highest precedence
  if (lease.requestedMaxRuntimeSeconds < merged.maximumRuntimeSeconds) {
    merged.maximumRuntimeSeconds = lease.requestedMaxRuntimeSeconds
  }
  if (lease.requestedMaxMemoryBytes < merged.maximumMemoryBytes) {
    merged.maximumMemoryBytes = lease.requestedMaxMemoryBytes
  }
  if (lease.requestedMaxOutputBytes < merged.maximumOutputBytes) {
    merged.maximumOutputBytes = lease.requestedMaxOutputBytes
  }
  if (lease.requestedMaxTokens !== null && lease.requestedMaxTokens < merged.maximumTokens) {
    merged.maximumTokens = lease.requestedMaxTokens
  }
  if (lease.requestedMaxGpuTimeMs !== null) {
    if (merged.maximumGpuTimeMs === null || lease.requestedMaxGpuTimeMs < merged.maximumGpuTimeMs) {
      merged.maximumGpuTimeMs = lease.requestedMaxGpuTimeMs
    }
  }

  return merged
}

// ── Budget Check ------------------------------------------------------------

type UsageReport = {
  runtimeMs?: number
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  memoryBytes?: number
  gpuTimeMs?: number
  outputBytes?: number
}

interface CheckResult {
  exceeded: boolean
  violations: string[]
}

/**
 * Check usage against a budget. Returns a list of violated limits.
 */
export function checkBudget(budget: ComputeBudget, usage: UsageReport): CheckResult {
  const violations: string[] = []

  if (usage.runtimeMs !== undefined && usage.runtimeMs > budget.maximumRuntimeSeconds * 1000) {
    violations.push(`runtime_ms exceeded: ${usage.runtimeMs} > ${budget.maximumRuntimeSeconds * 1000}`)
  }
  if (usage.tokens !== undefined && usage.tokens > budget.maximumTokens) {
    violations.push(`total_tokens exceeded: ${usage.tokens} > ${budget.maximumTokens}`)
  }
  if (usage.inputTokens !== undefined && usage.inputTokens > budget.maximumInputTokens) {
    violations.push(`input_tokens exceeded: ${usage.inputTokens} > ${budget.maximumInputTokens}`)
  }
  if (usage.outputTokens !== undefined && usage.outputTokens > budget.maximumOutputTokens) {
    violations.push(`output_tokens exceeded: ${usage.outputTokens} > ${budget.maximumOutputTokens}`)
  }
  if (usage.memoryBytes !== undefined && usage.memoryBytes > budget.maximumMemoryBytes) {
    violations.push(`memory_bytes exceeded: ${usage.memoryBytes} > ${budget.maximumMemoryBytes}`)
  }
  if (usage.gpuTimeMs !== undefined && budget.maximumGpuTimeMs !== null && usage.gpuTimeMs > budget.maximumGpuTimeMs) {
    violations.push(`gpu_time_ms exceeded: ${usage.gpuTimeMs} > ${budget.maximumGpuTimeMs}`)
  }
  if (usage.outputBytes !== undefined && usage.outputBytes > budget.maximumOutputBytes) {
    violations.push(`output_bytes exceeded: ${usage.outputBytes} > ${budget.maximumOutputBytes}`)
  }

  return { exceeded: violations.length > 0, violations }
}
