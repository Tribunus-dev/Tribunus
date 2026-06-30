/**
 * Prism Multi-Worker Router — Deployment Manifests
 *
 * Defines the deployment configuration for a multi-worker Prism
 * serving topology: namespace, replica counts, images, resource
 * limits, drain deadlines, and KV replay depth.
 */

export interface PrismMultiWorkerDeploymentConfig {
  /** Kubernetes namespace for the deployment */
  namespace: string

  /** Number of worker replicas to deploy */
  workerReplicas: number

  /** Container image for the model worker */
  workerImage: string

  /** Container image for the router sidecar */
  routerImage: string

  /** Volume path for model artifact storage */
  artifactVolume: string

  /** Volume path for compute image cache */
  computeImageCacheVolume: string

  /** Max depth of KV event replay buffer */
  kvEventReplayDepth: number

  /** Max concurrent requests per worker */
  workerRequestConcurrency: number

  /** Max input token count per request */
  workerMaxInputTokens: number

  /** Max output token count per request */
  workerMaxOutputTokens: number

  /** Deadline in ms for graceful drain */
  drainDeadlineMs: number
}

/**
 * Create a default multi-worker deployment configuration with
 * sensible defaults for a two-worker topology.
 */
export function createDefaultMultiWorkerConfig(): PrismMultiWorkerDeploymentConfig {
  return {
    namespace: "prism-multi-worker",
    workerReplicas: 2,
    workerImage: "prism/worker:latest",
    routerImage: "prism/router:latest",
    artifactVolume: "/var/lib/prism/artifacts",
    computeImageCacheVolume: "/var/lib/prism/compute-images",
    kvEventReplayDepth: 100,
    workerRequestConcurrency: 4,
    workerMaxInputTokens: 8192,
    workerMaxOutputTokens: 4096,
    drainDeadlineMs: 30_000,
  }
}
