/**
 * Benchmark Schema — Unit Tests
 */

import { expect, test, describe } from "bun:test"
import {
  createBenchmarkRecord,
  isBenchmarkQualified,
  classifyBenchmarkResult,
} from "../benchmark-suite"
import type { PrismMemoryDomainKind, PrismMemoryTransportKind } from "../fabric-types"

// ── Fixtures ────────────────────────────────────────────────────────────────

const CPU_DOMAIN: PrismMemoryDomainKind = "cpu_system_memory"
const APU_DOMAIN: PrismMemoryDomainKind = "apu_shared_memory"
const DGPU_DOMAIN: PrismMemoryDomainKind = "discrete_gpu_vram"
const SHARED_ACCESS: PrismMemoryTransportKind = "direct_shared_access"
const PEER_COPY: PrismMemoryTransportKind = "peer_device_copy"
const SERIALIZED: PrismMemoryTransportKind = "serialized_payload_copy"

// ── createBenchmarkRecord ──────────────────────────────────────────────────

describe("createBenchmarkRecord", () => {
  test("creates record with all expected fields", () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 0.5, 50_000_000_000)

    expect(record.sourceDomain).toBe(CPU_DOMAIN)
    expect(record.destinationDomain).toBe(APU_DOMAIN)
    expect(record.transportPath).toBe(SHARED_ACCESS)
    expect(record.transferBytes).toBe(4_194_304)
    expect(record.transferLatencyMs).toBe(0.5)
    expect(record.effectiveBandwidthBytesPerSecond).toBe(50_000_000_000)
    expect(record.hardwareProfile).toBe("prism_benchmark")
    expect(record.artifactClass).toBe("kv_cache_transfer")
    expect(record.prefillLatencyMs).toBeNull()
    expect(record.decodeLatencyMs).toBeNull()
  })

  test("round-trips dGPU → CPU with peer copy", () => {
    const record = createBenchmarkRecord(DGPU_DOMAIN, CPU_DOMAIN, PEER_COPY, 1_048_576, 2.0, 8_000_000_000)
    expect(record.sourceDomain).toBe(DGPU_DOMAIN)
    expect(record.destinationDomain).toBe(CPU_DOMAIN)
    expect(record.transportPath).toBe(PEER_COPY)
    expect(record.transferBytes).toBe(1_048_576)
  })
})

// ── isBenchmarkQualified ───────────────────────────────────────────────────

describe("isBenchmarkQualified", () => {
  test("passes when bandwidth above min and latency below max", () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 1.0, 40_000_000_000)
    expect(isBenchmarkQualified(record, 10_000_000_000, 5.0)).toBe(true)
  })

  test("fails when bandwidth below min", () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 0.5, 5_000_000_000)
    expect(isBenchmarkQualified(record, 10_000_000_000, 5.0)).toBe(false)
  })

  test("fails when latency above max", () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 10.0, 40_000_000_000)
    expect(isBenchmarkQualified(record, 10_000_000_000, 5.0)).toBe(false)
  })

  test("fails when both criteria miss", () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SERIALIZED, 1_000_000, 500.0, 100_000_000)
    expect(isBenchmarkQualified(record, 10_000_000_000, 5.0)).toBe(false)
  })

  test("passes at exact threshold boundaries", () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 5.0, 10_000_000_000)
    expect(isBenchmarkQualified(record, 10_000_000_000, 5.0)).toBe(true)
  })
})

// ── classifyBenchmarkResult ─────────────────────────────────────────────────

describe("classifyBenchmarkResult", () => {
  test('exceptional — high bandwidth and low latency', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 0.005, 60_000_000_000)
    expect(classifyBenchmarkResult(record)).toBe("exceptional")
  })

  test('excellent — high bandwidth only', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 50.0, 60_000_000_000)
    expect(classifyBenchmarkResult(record)).toBe("excellent")
  })

  test('excellent — low latency only', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 0.005, 5_000_000_000)
    expect(classifyBenchmarkResult(record)).toBe("excellent")
  })

  test('good — medium bandwidth and medium latency', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 0.05, 20_000_000_000)
    expect(classifyBenchmarkResult(record)).toBe("good")
  })

  test('adequate — medium latency only', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 0.05, 100_000_000)
    expect(classifyBenchmarkResult(record)).toBe("adequate")
  })

  test('adequate — medium bandwidth only', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SHARED_ACCESS, 4_194_304, 500.0, 20_000_000_000)
    expect(classifyBenchmarkResult(record)).toBe("adequate")
  })

  test('poor — below medium thresholds', () => {
    const record = createBenchmarkRecord(CPU_DOMAIN, APU_DOMAIN, SERIALIZED, 1_000_000, 500.0, 100_000_000)
    expect(classifyBenchmarkResult(record)).toBe("poor")
  })
})
