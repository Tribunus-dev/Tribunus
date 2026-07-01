/**
 * Prism llm-d Worker — Stream Frame Ordering
 *
 * Pure functions for constructing and inspecting SSE-formatted
 * streaming chunks compatible with the OpenAI streaming protocol.
 */

import type { WorkerErrorCode } from "./worker-types"

/**
 * Create a delta content chunk in SSE format.
 * @param sequence — monotonically increasing frame index
 * @param content — text delta for this chunk
 * @param isFinal — whether this is the last content chunk before the [DONE] signal
 */
export function createStreamChunk(sequence: number, content: string, isFinal: boolean): string {
  let data = `id: ${sequence}\nevent: delta\ndata: ${JSON.stringify({ content, sequence })}\n\n`
  if (isFinal) {
    data += `id: ${sequence}\nevent: done\ndata: [DONE]\n\n`
  }
  return data
}

/**
 * Create the terminal [DONE] signal in SSE format.
 * @param sequence — final frame index
 */
export function createStreamDone(sequence: number): string {
  return `id: ${sequence}\nevent: done\ndata: [DONE]\n\n`
}

/**
 * Determine the event type of a stream chunk string.
 */
export function getStreamEventType(chunk: string): "delta" | "done" | "error" {
  if (chunk.includes("event: error")) return "error"
  if (chunk.includes("event: done") || chunk.includes("data: [DONE]")) return "done"
  if (chunk.includes("event: delta")) return "delta"
  return "delta"
}
