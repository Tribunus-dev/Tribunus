/**
 * Prism llm-d Worker — Metrics Collector Interface + In-Memory Collector
 *
 * Defines the WorkerMetrics interface and provides a pure in-memory
 * implementation backed by a flat counter map.
 */

export interface WorkerMetrics {
  recordRequest(modelId: string): void
  recordFailure(modelId: string, errorCode: string): void
  recordCancellation(modelId: string): void
  recordPrefillDuration(ms: number): void
  recordDecodeDuration(ms: number): void
  recordTokens(input: number, output: number): void
  recordKvEvent(bytes: number, hit: boolean): void
  recordModelLoadDuration(ms: number): void
  recordComputeImageLoadDuration(ms: number): void
  recordUsageReceipt(): void
  getInflight(): number
  getSnapshot(): Record<string, number>
}

interface CounterState {
  requests: Record<string, number>
  failures: Record<string, number>
  cancellations: Record<string, number>
  prefillDurationMs: number
  decodeDurationMs: number
  inputTokens: number
  outputTokens: number
  kvEvents: number
  kvHits: number
  kvMisses: number
  kvBytes: number
  modelLoadDurationMs: number
  computeImageLoadDurationMs: number
  usageReceipts: number
  inflight: number
}

export function createMetricsCollector(): WorkerMetrics {
  const state: CounterState = {
    requests: {},
    failures: {},
    cancellations: {},
    prefillDurationMs: 0,
    decodeDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    kvEvents: 0,
    kvHits: 0,
    kvMisses: 0,
    kvBytes: 0,
    modelLoadDurationMs: 0,
    computeImageLoadDurationMs: 0,
    usageReceipts: 0,
    inflight: 0,
  }

  return {
    recordRequest(modelId: string): void {
      state.requests[modelId] = (state.requests[modelId] ?? 0) + 1
      state.inflight++
    },
    recordFailure(modelId: string, errorCode: string): void {
      const key = `${modelId}:${errorCode}`
      state.failures[key] = (state.failures[key] ?? 0) + 1
    },
    recordCancellation(modelId: string): void {
      state.cancellations[modelId] = (state.cancellations[modelId] ?? 0) + 1
    },
    recordPrefillDuration(ms: number): void {
      state.prefillDurationMs += ms
    },
    recordDecodeDuration(ms: number): void {
      state.decodeDurationMs += ms
    },
    recordTokens(input: number, output: number): void {
      state.inputTokens += input
      state.outputTokens += output
    },
    recordKvEvent(bytes: number, hit: boolean): void {
      state.kvEvents++
      state.kvBytes += bytes
      if (hit) {
        state.kvHits++
      } else {
        state.kvMisses++
      }
    },
    recordModelLoadDuration(ms: number): void {
      state.modelLoadDurationMs += ms
    },
    recordComputeImageLoadDuration(ms: number): void {
      state.computeImageLoadDurationMs += ms
    },
    recordUsageReceipt(): void {
      state.usageReceipts++
    },
    getInflight(): number {
      return state.inflight
    },
    getSnapshot(): Record<string, number> {
      return {
        ...state.requests,
        ...Object.fromEntries(
          Object.entries(state.failures).map(([k]) => [`failure:${k}`, state.failures[k]!]),
        ),
        ...Object.fromEntries(
          Object.entries(state.cancellations).map(([k]) => [`cancellation:${k}`, state.cancellations[k]!]),
        ),
        prefillDurationMs: state.prefillDurationMs,
        decodeDurationMs: state.decodeDurationMs,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        kvEvents: state.kvEvents,
        kvHits: state.kvHits,
        kvMisses: state.kvMisses,
        kvBytes: state.kvBytes,
        modelLoadDurationMs: state.modelLoadDurationMs,
        computeImageLoadDurationMs: state.computeImageLoadDurationMs,
        usageReceipts: state.usageReceipts,
        inflight: state.inflight,
      }
    },
  }
}
