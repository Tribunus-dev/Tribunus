/**
 * Prism llm-d Worker — Model Deployment Config Tests
 */

import { describe, it, expect } from "bun:test"
import {
  createDeploymentConfig,
  getModelStorePath,
  getDefaultWorkerBinaryPath,
  createGemma2BDeployment,
} from "../model-deployment"
import type { ModelDeploymentConfig } from "../model-deployment"

describe("createDeploymentConfig", () => {
  it("creates a config with the given modelId, hfRepo, and hfFilename", () => {
    const config = createDeploymentConfig(
      "test-model",
      "test-owner/test-repo",
      "test-model-Q4_K_M.gguf",
    )
    expect(config.modelId).toBe("test-model")
    expect(config.hfRepo).toBe("test-owner/test-repo")
    expect(config.hfFilename).toBe("test-model-Q4_K_M.gguf")
  })

  it("derives modelFamily from hfRepo", () => {
    const config = createDeploymentConfig(
      "llama-3.2-1b",
      "meta-llama/Llama-3.2-1B-GGUF",
      "llama-3.2-1b-Q4_K_M.gguf",
    )
    expect(config.modelFamily).toBe("Llama-3.2-1B-GGUF")
  })

  it("derives quantizationScheme from hfFilename", () => {
    const config = createDeploymentConfig(
      "phi-4",
      "microsoft/phi-4-GGUF",
      "phi-4-Q8_0.gguf",
    )
    expect(config.quantizationScheme).toBe("Q8_0")
  })

  it("sets quantizationScheme to 'unknown' when filename has no quantization pattern", () => {
    const config = createDeploymentConfig(
      "bare-model",
      "owner/bare",
      "model-f16.bin",
    )
    expect(config.quantizationScheme).toBe("unknown")
  })

  it("sets default supportedContextLength to 8192", () => {
    const config = createDeploymentConfig("m", "o/r", "m.gguf")
    expect(config.supportedContextLength).toBe(8192)
  })

  it("sets expectedDigest to empty string", () => {
    const config = createDeploymentConfig("m", "o/r", "m.gguf")
    expect(config.expectedDigest).toBe("")
  })

  it("sets workerBinaryPath to the default", () => {
    const config = createDeploymentConfig("m", "o/r", "m.gguf")
    expect(config.workerBinaryPath).toBe(getDefaultWorkerBinaryPath())
  })
})

describe("getModelStorePath", () => {
  it("returns a non-empty string", () => {
    const path = getModelStorePath()
    expect(path.length).toBeGreaterThan(0)
  })

  it("includes 'prism/models' in the path", () => {
    const path = getModelStorePath()
    expect(path).toContain("prism")
    expect(path).toContain("models")
  })

  it("respects XDG_DATA_HOME when set", () => {
    const original = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = "/custom/data"
    try {
      const path = getModelStorePath()
      expect(path).toBe("/custom/data/prism/models")
    } finally {
      process.env.XDG_DATA_HOME = original
    }
  })
})

describe("getDefaultWorkerBinaryPath", () => {
  it("returns a non-empty string", () => {
    const path = getDefaultWorkerBinaryPath()
    expect(path.length).toBeGreaterThan(0)
  })

  it("returns 'llama-server' as the default binary name", () => {
    const path = getDefaultWorkerBinaryPath()
    expect(path).toBe("llama-server")
  })
})

describe("createGemma2BDeployment", () => {
  it("returns a fully populated ModelDeploymentConfig", () => {
    const config = createGemma2BDeployment()
    expect(config.modelId).toBe("gemma-4-2b-it")
    expect(config.hfRepo).toBe("google/gemma-4-2b-it-GGUF")
    expect(config.hfFilename).toBe("gemma-4-2b-it-Q4_K_M.gguf")
    expect(config.modelFamily).toBe("gemma4")
    expect(config.quantizationScheme).toBe("Q4_K_M")
    expect(config.supportedContextLength).toBe(8192)
    expect(config.workerBinaryPath).toBe(getDefaultWorkerBinaryPath())
  })

  it("has empty expectedDigest until downloaded", () => {
    const config = createGemma2BDeployment()
    expect(config.expectedDigest).toBe("")
  })

  it("is a valid ModelDeploymentConfig", () => {
    const config = createGemma2BDeployment()
    const keys: (keyof ModelDeploymentConfig)[] = [
      "modelId",
      "hfRepo",
      "hfFilename",
      "modelFamily",
      "quantizationScheme",
      "expectedDigest",
      "supportedContextLength",
      "workerBinaryPath",
    ]
    for (const key of keys) {
      expect(config[key]).toBeDefined()
    }
  })
})
