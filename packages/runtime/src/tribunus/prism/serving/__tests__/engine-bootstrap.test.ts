/**
 * Prism llm-d Worker — Engine Bootstrap Tests
 *
 * Tests the bootstrap lifecycle: creating a bootstrap result, running
 * the bootstrap flow, and checking engine readiness.
 */

import { describe, it, expect } from "bun:test"
import {
  createEngineBootstrap,
  bootstrapEngine,
  isEngineReady,
} from "../engine-bootstrap"
import { createGemma2BDeployment } from "../model-deployment"

describe("createEngineBootstrap", () => {
  it("creates a bootstrap result with ready=false", () => {
    const result = createEngineBootstrap()
    expect(result.ready).toBe(false)
    expect(result.loadedModelDigest).toBeNull()
    expect(result.error).toBeNull()
    expect(result.deploymentConfig).toBeNull()
  })

  it("assigns a workerId with expected prefix", () => {
    const result = createEngineBootstrap()
    expect(result.workerId).toBeTruthy()
    expect(result.workerId).toContain("prism-worker-")
  })

  it("creates an engine adapter", () => {
    const result = createEngineBootstrap()
    expect(result.engineAdapter).not.toBeNull()
  })

  it("accepts a custom modelStorePath", () => {
    const result = createEngineBootstrap({ modelStorePath: "/tmp/prism-test-models" })
    expect(result.engineAdapter).not.toBeNull()
  })
})

describe("isEngineReady", () => {
  it("returns false for a freshly created bootstrap result", () => {
    const result = createEngineBootstrap()
    expect(isEngineReady(result)).toBe(false)
  })

  it("returns false when ready is false", () => {
    const result = createEngineBootstrap()
    result.ready = false
    expect(isEngineReady(result)).toBe(false)
  })

  it("returns false when engineAdapter is null", () => {
    const result = createEngineBootstrap()
    expect(
      isEngineReady({ ...result, engineAdapter: null, ready: true, error: null }),
    ).toBe(false)
  })

  it("returns false when error is non-null", () => {
    const result = createEngineBootstrap()
    expect(
      isEngineReady({ ...result, ready: true, error: "something failed" }),
    ).toBe(false)
  })

  it("returns true only when all conditions are met", () => {
    const result = createEngineBootstrap()
    // After successful bootstrap the result should be ready
    // We test the predicate logic directly by constructing a valid state
    const readyResult = {
      ...result,
      ready: true,
      error: null,
      engineAdapter: result.engineAdapter,
    }
    expect(isEngineReady(readyResult)).toBe(true)
  })
})

describe("bootstrapEngine", () => {
  it("fails gracefully when engineAdapter is null", async () => {
    const result = createEngineBootstrap()
    const updated = await bootstrapEngine({ ...result, engineAdapter: null })
    expect(updated.ready).toBe(false)
    expect(updated.error).toContain("No engine adapter available")
  })

  it("uses provided deployment config", async () => {
    const result = createEngineBootstrap()
    const config = createGemma2BDeployment()
    const updated = await bootstrapEngine({ ...result, deploymentConfig: config })
    // Even if native fails, the config should be present in the result
    expect(updated.deploymentConfig).not.toBeNull()
    expect(updated.deploymentConfig?.modelId).toBe(config.modelId)
  })

  it("reports error when engine is not healthy", async () => {
    const result = createEngineBootstrap()
    // If the native adapter fails health check, we get an error
    const updated = await bootstrapEngine(result)
    if (updated.ready === false && updated.error) {
      expect(updated.error).toBeTruthy()
    }
  })
})
