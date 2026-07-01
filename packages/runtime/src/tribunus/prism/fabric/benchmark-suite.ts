/**
 * Prism Heterogeneous Memory Fabric — Benchmark Suite
 *
 * Pure functions for creating, qualifying, and classifying fabric benchmark
 * records that measure real-world transfer performance between memory domains.
 */

import type {
  PrismFabricBenchmarkRecord,
  PrismMemoryDomainKind,
  PrismMemoryTransportKind,
} from "./fabric-types"

// ── Classification Thresholds ───────────────────────────────────────────────

const HIGH_BANDWIDTH_THRESHOLD = 50_000_000_000 // 50 GB/s
const MEDIUM_BANDWIDTH_THRESHOLD = 10_000_000_000 // 10 GB/s
const LOW_LATENCY_THRESHOLD_US = 10 // 10 µs
const MEDIUM_LATENCY_THRESHOLD_US = 100 // 100 µs

// ── Record Factory ──────────────────────────────────────────────────────────

/**
 * Create a benchmark record for a single transport-path measurement.
 *
 * @param sourceDomain   — originating memory domain kind
 * @param destDomain     — destination memory domain kind
 * @param transportKind  — transport mechanism used
 * @param bytes          — payload size transferred
 * @param latencyMs      — measured end-to-end latency in milliseconds
 * @param bandwidth      — measured effective bandwidth in bytes/second
 */
export function createBenchmarkRecord(
  sourceDomain: PrismMemoryDomainKind,
  destDomain: PrismMemoryDomainKind,
  transportKind: PrismMemoryTransportKind,
  bytes: number,
  latencyMs: number,
  bandwidth: number,
): PrismFabricBenchmarkRecord {
  return {
    hardwareProfile: "prism_benchmark",
    driverVersion: "1.0.0",
    runtimeVersion: "1.0.0",
    backendVersion: "1.0.0",
    artifactClass: "kv_cache_transfer",
    payloadSize: bytes,
    promptLengthClass: "medium",
    outputLengthClass: "medium",
    sourceDomain,
    destinationDomain: destDomain,
    transportPath: transportKind,
    transferBytes: bytes,
    transferLatencyMs: latencyMs,
    effectiveBandwidthBytesPerSecond: bandwidth,
    prefillLatencyMs: null,
    decodeLatencyMs: null,
    tokenThroughput: null,
    peakMemoryBytes: null,
    failureBehavior: null,
  }
}

// ── Qualification ───────────────────────────────────────────────────────────

/**
 * Check whether a benchmark record meets a minimum bandwidth and maximum
 * latency threshold (typical SLO qualification).
 */
export function isBenchmarkQualified(
  record: PrismFabricBenchmarkRecord,
  minBandwidth: number,
  maxLatencyMs: number,
): boolean {
  return (
    record.effectiveBandwidthBytesPerSecond >= minBandwidth &&
    record.transferLatencyMs <= maxLatencyMs
  )
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a benchmark record into a human-readable performance tier.
 *
 * Tiers (from best to worst):
 * - "exceptional" — high bandwidth AND low latency
 * - "excellent"  — high bandwidth OR low latency
 * - "good"       — medium bandwidth AND medium latency
 * - "adequate"   — medium bandwidth OR medium latency
 * - "poor"       — below medium thresholds
 */
export function classifyBenchmarkResult(record: PrismFabricBenchmarkRecord): string {
  const bw = record.effectiveBandwidthBytesPerSecond
  const latUs = record.transferLatencyMs * 1000 // convert ms to µs

  const isHighBW = bw >= HIGH_BANDWIDTH_THRESHOLD
  const isMidBW = bw >= MEDIUM_BANDWIDTH_THRESHOLD
  const isLowLatency = latUs <= LOW_LATENCY_THRESHOLD_US
  const isMidLatency = latUs <= MEDIUM_LATENCY_THRESHOLD_US

  if (isHighBW && isLowLatency) return "exceptional"
  if (isHighBW || isLowLatency) return "excellent"
  if (isMidBW && isMidLatency) return "good"
  if (isMidBW || isMidLatency) return "adequate"
  return "poor"
}
