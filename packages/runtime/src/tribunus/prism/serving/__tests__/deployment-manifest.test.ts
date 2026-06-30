/**
 * Prism llm-d Worker — Deployment Manifest Tests
 */

import { describe, it, expect } from "bun:test"
import { createDefaultDeploymentConfig } from "../deployment-manifest"

describe("createDefaultDeploymentConfig", () => {
  it("sets the provided workerId", () => {
    const cfg = createDefaultDeploymentConfig("worker-xyz")
    expect(cfg.workerId).toBe("worker-xyz")
  })

  it("sets default artifact registry location", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.artifactRegistryLocation).toBe("/var/lib/prism/artifacts")
  })

  it("sets empty artifact allowlist", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.artifactAllowlist).toEqual([])
  })

  it("sets compute image cache location", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.computeImageCacheLocation).toBe("/var/lib/prism/compute-images")
  })

  it("sets target capability policy to 'default'", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.targetCapabilityPolicy).toBe("default")
  })

  it("sets requestConcurrencyLimit to 4", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.requestConcurrencyLimit).toBe(4)
  })

  it("sets maxInputTokens to 8192", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.maxInputTokens).toBe(8192)
  })

  it("sets maxOutputTokens to 4096", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.maxOutputTokens).toBe(4096)
  })

  it("sets memoryLimitBytes to 8 GiB", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.memoryLimitBytes).toBe(8 * 1024 * 1024 * 1024)
  })

  it("sets drainDeadlineMs to 30000", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.drainDeadlineMs).toBe(30_000)
  })

  it("sets kvEventReplayDepth to 100", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.kvEventReplayDepth).toBe(100)
  })

  it("sets empty receiptSigningKeyRef", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.receiptSigningKeyRef).toBe("")
  })

  it("sets dharmaCorrelationEnabled to false", () => {
    const cfg = createDefaultDeploymentConfig("test")
    expect(cfg.dharmaCorrelationEnabled).toBe(false)
  })
})

describe("PrismWorkerDeploymentConfig type", () => {
  it("accepts a fully constructed config", () => {
    const cfg = createDefaultDeploymentConfig("worker-42")
    expect(cfg.workerId).toBe("worker-42")
    expect(typeof cfg.requestConcurrencyLimit).toBe("number")
    expect(typeof cfg.memoryLimitBytes).toBe("number")
    expect(typeof cfg.drainDeadlineMs).toBe("number")
    expect(Array.isArray(cfg.artifactAllowlist)).toBe(true)
    expect(typeof cfg.dharmaCorrelationEnabled).toBe("boolean")
  })
})
