// Prism Engine napi bindings — TypeScript declarations

export interface NapiEngineCapabilities {
  supportsGpu: boolean
  supportsCoreml: boolean
  mlxVersion: string
}

export interface NapiServerConfig {
  modelStorePath: string
  maxConcurrentSessions: number
  maxInputTokens: number
  maxOutputTokens: number
}

export interface NapiGenerationResult {
  tokenIds: number[]
  output: string
  tokenCount: number
  jobId: string
}

export interface NapiUsageReceipt {
  sessionId: string
  modelDigest: string
  inputTokens: number
  outputTokens: number
  prefillDurationMs: number
  decodeDurationMs: number
  totalDurationMs: number
  finalState: string
}

export class PrismInferenceServer {
  constructor(config: NapiServerConfig)
  createSession(modelDigest: string): string
  generate(sessionId: string, inputIds: number[], maxTokens: number): NapiGenerationResult
  cancel(sessionId: string): NapiUsageReceipt
  closeSession(sessionId: string): NapiUsageReceipt
  capabilities(): NapiEngineCapabilities
}

export class ComputeEngine {
  constructor()
  loadModel(imageHash: string): void
  unloadModel(): void
  generate(inputIds: number[], maxTokens: number): NapiGenerationResult
  cancel(jobId: string): void
  capabilities(): NapiEngineCapabilities
}

// Legacy flat API
export function nativeCapabilityReport(): { mlxVersion: string; gpuAvailable: boolean; coremlAvailable: boolean; metalAvailable: boolean; recommendedBackend: string }
export function engineGenerate(inputIds: number[], maxTokens: number): { jobId: string; tokenIds?: number[]; output?: string; tokenCount?: number }
export function engineCancelGeneration(jobId: string): void
export function engineInstallModel(sourceDir: string, imageHash: string, sourceIdentity: string, compilerVersion: string): { ok: boolean; error?: string }
export function generationChannel(): { sender: number; stream: number }
export function validateEventSequence(events: string[]): boolean
export function mlxActiveMemory(): number
export function mlxClearCache(): void
