/**
 * Prism llm-d Worker — Engine Bootstrap
 *
 * Wires the PrismEngineAdapter with a real model deployment config.
 * Bootstrap lifecycle: check if model exists → if not, configure
 * deployment → load model via engine adapter → verify readiness.
 *
 * This is the production ready-runner's entry point; it replaces the
 * stub-based wiring used in integration tests.
 */

import { existsSync, readdirSync } from "fs"
import { join } from "path"

import { PrismEngineAdapter } from "./engine-adapter"
import {
  getModelStorePath,
  getDefaultWorkerBinaryPath,
  createGemma2BDeployment,
} from "./model-deployment"

import type { ModelDeploymentConfig } from "./model-deployment"

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * The consolidated result of an engine bootstrap attempt.
 */
export interface EngineBootstrapResult {
  /** Whether the engine and model are ready to serve requests */
  ready: boolean
  /** Unique worker instance identifier */
  workerId: string
  /** Digest of the model artifact loaded into the engine, or null */
  loadedModelDigest: string | null
  /** Error message if bootstrap failed, or null on success */
  error: string | null
  /** The deployment config used during bootstrap (or null) */
  deploymentConfig: ModelDeploymentConfig | null
  /** The live engine adapter, or null if construction failed */
  engineAdapter: PrismEngineAdapter | null
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create an initial bootstrap result with a fresh engine adapter.
 *
 * The result starts in a non-ready state. Call `bootstrapEngine()` to
 * run the full bootstrap lifecycle.
 */
export function createEngineBootstrap(config?: {
  modelStorePath?: string
}): EngineBootstrapResult {
  const workerId = `prism-worker-${Date.now()}`
  const storePath = config?.modelStorePath ?? getModelStorePath()

  let adapter: PrismEngineAdapter | null = null
  try {
    adapter = new PrismEngineAdapter({ modelStorePath: storePath })
  } catch (err) {
    return {
      ready: false,
      workerId,
      loadedModelDigest: null,
      error: `Failed to create engine adapter: ${(err as Error).message}`,
      deploymentConfig: null,
      engineAdapter: null,
    }
  }

  return {
    ready: false,
    workerId,
    loadedModelDigest: null,
    error: null,
    deploymentConfig: null,
    engineAdapter: adapter,
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Run the full engine bootstrap lifecycle.
 *
 * 1. Verify the engine adapter is healthy.
 * 2. Use the provided deployment config or default to Gemma 4 2B.
 * 3. Scan the model store for the required artifact.
 * 4. Attempt to load the model via the engine.
 * 5. Mark the engine as ready if the model loaded successfully.
 *
 * Returns the updated result with readiness, error, and loaded digest.
 */
export async function bootstrapEngine(
  result: EngineBootstrapResult,
): Promise<EngineBootstrapResult> {
  // ── Engine health check ───────────────────────────────────────────────
  if (!result.engineAdapter) {
    return {
      ...result,
      ready: false,
      error: "No engine adapter available — bootstrap cannot proceed",
    }
  }

  if (!result.engineAdapter.isHealthy()) {
    return {
      ...result,
      ready: false,
      error: "Engine adapter reports unhealthy state",
    }
  }

  // ── Deployment config ─────────────────────────────────────────────────
  const config = result.deploymentConfig ?? createGemma2BDeployment()

  // ── Check model store for the artifact ────────────────────────────────
  const storePath = getModelStorePath()
  let modelDigest = config.modelId

  try {
    const digest = findModelInStore(storePath, config)
    if (digest) {
      modelDigest = digest
    }
  } catch {
    // No store yet or model not found — that's fine, we still try loading
  }

  // ── Load the model ────────────────────────────────────────────────────
  let sessionId: string | null = null
  try {
    sessionId = result.engineAdapter.createSession(modelDigest)
  } catch (err) {
    return {
      ...result,
      ready: false,
      loadedModelDigest: null,
      error: `Model load failed: ${(err as Error).message}`,
      deploymentConfig: config,
    }
  }

  // Verify the session is valid by closing it immediately
  try {
    result.engineAdapter.closeSession(sessionId)
  } catch {
    // Non-fatal — session may not support close
  }

  return {
    ...result,
    ready: true,
    loadedModelDigest: modelDigest,
    error: null,
    deploymentConfig: config,
  }
}

// ── Query ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the bootstrap result indicates the engine is ready
 * to serve requests.
 */
export function isEngineReady(result: EngineBootstrapResult): boolean {
  return result.ready === true && result.error === null && result.engineAdapter !== null
}

// ── Internal Helpers ──────────────────────────────────────────────────────

/**
 * Scan the model store directory for a matching GGUF artifact.
 *
 * Returns the first matching digest (the SHA-256 part of the filename),
 * or null if no matching model is found.
 */
function findModelInStore(
  storePath: string,
  config: ModelDeploymentConfig,
): string | null {
  if (!existsSync(storePath)) {
    return null
  }

  const entries = readdirSync(storePath)
  const modelFiles = entries.filter(
    (e) => e.endsWith(".gguf") && (e.includes(config.modelId) || e.includes(config.hfFilename)),
  )

  if (modelFiles.length === 0) {
    return null
  }

  // Return the sha256-based digest if the filename uses a digest prefix
  const matched = modelFiles[0]
  const digestMatch = matched.match(/^([a-f0-9]{64})[._]/)
  if (digestMatch) {
    return digestMatch[1]
  }

  // Otherwise use the filename stem as the digest reference
  return matched.replace(/\.gguf$/, "")
}
