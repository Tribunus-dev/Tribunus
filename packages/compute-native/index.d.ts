// TypeScript declarations for the Prism Engine napi bindings

export interface NapiEngineCapabilities {
  supportsGpu: boolean
  supportsCoreml: boolean
  mlxVersion: string
}

export interface NapiGenerationResult {
  tokenIds: number[]
  output: string
  tokenCount: number
  jobId: string
}

export class ComputeEngine {
  constructor()
  loadModel(imageHash: string): void
  unloadModel(): void
  generate(inputIds: number[], maxTokens: number): NapiGenerationResult
  cancel(jobId: string): void
  capabilities(): NapiEngineCapabilities
}
