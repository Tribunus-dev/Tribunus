/**
 * Prism llm-d Worker — Model Deployment Configuration
 *
 * Describes how to download, verify, and install a GGUF model artifact
 * for use with the Prism inference engine.
 */

import { homedir } from "os"
import { join } from "path"

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Configuration for deploying a GGUF model from HuggingFace.
 */
export interface ModelDeploymentConfig {
  /** Unique model identifier (e.g. "gemma-4-2b-it") */
  modelId: string
  /** HuggingFace repository (e.g. "google/gemma-4-2b-it-GGUF") */
  hfRepo: string
  /** Filename within the HF repo (e.g. "gemma-4-2b-it-Q4_K_M.gguf") */
  hfFilename: string
  /** Model architecture family (e.g. "gemma4", "llama3", "phi4") */
  modelFamily: string
  /** Quantization scheme (e.g. "Q4_K_M", "Q8_0", "F16") */
  quantizationScheme: string
  /** SHA-256 digest of the expected artifact (empty string if unknown) */
  expectedDigest: string
  /** Maximum context length the model supports in tokens */
  supportedContextLength: number
  /** Path to the worker binary that loads and executes this model */
  workerBinaryPath: string
}

/**
 * Result of a deployment attempt.
 */
export interface DeploymentResult {
  /** Model identifier that was deployed */
  modelId: string
  /** SHA-256 digest of the downloaded artifact */
  artifactDigest: string
  /** ISO-8601 timestamp of when the artifact was installed */
  installedAt: string
  /** Whether the deployment succeeded */
  success: boolean
  /** Error message if deployment failed, null otherwise */
  error: string | null
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MODEL_STORE_NAME = ".prism/models"
const DEFAULT_WORKER_BINARY_NAME = "llama-server"

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a deployment configuration from minimal identifying fields.
 *
 * Infers quantization scheme from the filename, model family from the
 * HuggingFace repo name, and uses sensible defaults for remaining fields.
 */
export function createDeploymentConfig(
  modelId: string,
  hfRepo: string,
  hfFilename: string,
): ModelDeploymentConfig {
  // Extract model family from hfRepo (the name part after owner/)
  const modelFamily = hfRepo.includes("/") ? hfRepo.split("/")[1] : hfRepo

  // Derive quantization scheme from filename by extracting patterns like Q4_K_M
  const quantizationMatch = hfFilename.match(/[Qq]\d+[_\w]*[KkMmHh]?/)
  const quantizationScheme = quantizationMatch ? quantizationMatch[0].toUpperCase() : "unknown"

  return {
    modelId,
    hfRepo,
    hfFilename,
    modelFamily,
    quantizationScheme,
    expectedDigest: "",
    supportedContextLength: 8192,
    workerBinaryPath: getDefaultWorkerBinaryPath(),
  }
}

// ── Path Resolution ────────────────────────────────────────────────────────

/**
 * Return the default model store path for GGUF artifacts.
 *
 * Uses XDG_DATA_HOME or falls back to ~/.local/share/prism/models.
 */
export function getModelStorePath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "prism", "models")
}

/**
 * Return the default path for the model worker binary.
 *
 * Checks PATH first for `llama-server`, then falls back to common
 * installation locations.
 */
export function getDefaultWorkerBinaryPath(): string {
  // Prefer llama-server from PATH; fall back to common install locations
  const searchPaths = [
    "llama-server",
    "/usr/local/bin/llama-server",
    "/opt/homebrew/bin/llama-server",
    join(homedir(), ".local", "bin", "llama-server"),
  ]

  // Note: during bootstrap these are checked against the filesystem;
  // at config-creation time we return the PATH default.
  return searchPaths[0]
}

// ── Well-Known Deployments ─────────────────────────────────────────────────

/**
 * Create a deployment configuration for Gemma 4 2B (the smallest useful
 * GGUF model, suitable for Apple Silicon with 16GB unified memory).
 *
 * - 2 billion parameters
 * - Q4_K_M quantization balances quality and memory (~1.5 GB VRAM)
 * - 8192 token context window
 * - Ideal for M1-class hardware
 */
export function createGemma2BDeployment(): ModelDeploymentConfig {
  return {
    modelId: "gemma-4-2b-it",
    hfRepo: "google/gemma-4-2b-it-GGUF",
    hfFilename: "gemma-4-2b-it-Q4_K_M.gguf",
    modelFamily: "gemma4",
    quantizationScheme: "Q4_K_M",
    expectedDigest: "",
    supportedContextLength: 8192,
    workerBinaryPath: getDefaultWorkerBinaryPath(),
  }
}
