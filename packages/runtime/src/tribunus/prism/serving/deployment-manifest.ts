/**
 * Prism llm-d Worker — Deployment Configuration
 *
 * Defines the deployment manifest structure that configures a Prism
 * worker instance, including resource limits, artifact paths, and
 * operational parameters.
 */

/**
 * Full deployment configuration for a Prism worker.
 */
export interface PrismWorkerDeploymentConfig {
  /** Unique identifier for this worker instance */
  workerId: string
  /** Location of the artifact registry (e.g. filesystem path or S3 URI) */
  artifactRegistryLocation: string
  /** Artifact digest allowlist — only these digests are admitted */
  artifactAllowlist: string[]
  /** Local cache path for compute images */
  computeImageCacheLocation: string
  /** Reference to the target capability policy document */
  targetCapabilityPolicy: string
  /** Maximum concurrent requests this worker will handle */
  requestConcurrencyLimit: number
  /** Maximum input tokens per request */
  maxInputTokens: number
  /** Maximum output tokens per request */
  maxOutputTokens: number
  /** Memory limit for the worker process in bytes */
  memoryLimitBytes: number
  /** Maximum time in ms to wait for drain completion before force-stop */
  drainDeadlineMs: number
  /** Number of past KV events to retain for replay */
  kvEventReplayDepth: number
  /** Key reference for signing usage receipts */
  receiptSigningKeyRef: string
  /** Whether Dharma lease correlation is enabled */
  dharmaCorrelationEnabled: boolean
}

/**
 * Create a default deployment configuration for a given worker ID.
 */
export function createDefaultDeploymentConfig(workerId: string): PrismWorkerDeploymentConfig {
  return {
    workerId,
    artifactRegistryLocation: "/var/lib/prism/artifacts",
    artifactAllowlist: [],
    computeImageCacheLocation: "/var/lib/prism/compute-images",
    targetCapabilityPolicy: "default",
    requestConcurrencyLimit: 4,
    maxInputTokens: 8192,
    maxOutputTokens: 4096,
    memoryLimitBytes: 8 * 1024 * 1024 * 1024, // 8 GiB
    drainDeadlineMs: 30_000,
    kvEventReplayDepth: 100,
    receiptSigningKeyRef: "",
    dharmaCorrelationEnabled: false,
  }
}
