import { Schema, Effect, Stream, Option } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpServerResponse } from "effect/unstable/http"
import * as Sse from "effect/unstable/encoding/Sse"
import { Authorization } from "./middleware/authorization"
import { InstanceContextMiddleware } from "./middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "./middleware/workspace-routing"
import { InvalidRequestError } from "./errors"

export const StreamPaths = {
  completions: "/v1/chat/completions",
} as const

export const StreamPayload = Schema.Struct({
  messages: Schema.Array(Schema.Any),
  model: Schema.String,
  stream: Schema.Boolean,
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  max_tokens: Schema.optional(Schema.Number),
  stop: Schema.optional(Schema.Unknown),
  tools: Schema.optional(Schema.Array(Schema.Any)),
})

export const StreamApi = HttpApi.make("stream").add(
  HttpApiGroup.make("stream")
    .add(
      HttpApiEndpoint.post("chatCompletions", StreamPaths.completions, {
        query: WorkspaceRoutingQuery,
        payload: StreamPayload,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "stream.chatCompletions",
          summary: "Chat Completions SSE",
          description: "OpenAI-compatible streaming chat completions endpoint",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization)
    .annotateMerge(OpenApi.annotations({ title: "stream", description: "Instance SSE streaming route." })),
)

// Aho-Corasick automaton stop condition detector (mock)
class StopDetector {
  constructor(public stops: string[]) {}
  check(text: string): boolean {
    return this.stops.some((s) => text.includes(s))
  }
}

function tokenize(input: any) {
  // Mock token intake & radix-tree
  return ["prefill_done"]
}

// Mock pipeline_decode & detokenize
export function decodeLoop(payload: any) {
  const maxTokens = payload.max_tokens || 10
  const stops = payload.stop
    ? Array.isArray(payload.stop)
      ? payload.stop
      : [payload.stop]
    : []
  const stopDetector = new StopDetector(stops)
  
  let generatedTokens = 0
  
  return Stream.fromAsyncIterable(async function* () {
    for (let n = 0; n <= maxTokens; n++) {
      if (n >= maxTokens) {
        yield { _tag: "Event", event: "stop", id: undefined, data: JSON.stringify({ reason: "stop", tokens_generated: generatedTokens, tokens_per_second: 42.5 }) } as Sse.Event
        yield { _tag: "Event", event: "message", id: undefined, data: "[DONE]" } as Sse.Event
        return
      }

      const tokenStr = n === 0 ? "hello" : " world"
      generatedTokens++
      
      // Simulate Aho-Corasick stop detection
      if (stopDetector.check(tokenStr)) {
        yield { _tag: "Event", event: "stop", id: undefined, data: JSON.stringify({ reason: "stop", tokens_generated: generatedTokens, tokens_per_second: 42.5 }) } as Sse.Event
        yield { _tag: "Event", event: "message", id: undefined, data: "[DONE]" } as Sse.Event
        return
      }

      // Mock tool calling
      if (payload.tools && payload.tools.length > 0 && n === 2) {
        yield { _tag: "Event", event: "tool_call", id: undefined, data: JSON.stringify({ name: "search_web", arguments: { query: "weather" } }) } as Sse.Event
        yield { _tag: "Event", event: "message", id: undefined, data: "[DONE]" } as Sse.Event
        return
      }

      yield { _tag: "Event", event: "token", id: undefined, data: JSON.stringify({ token: tokenStr, index: n }) } as Sse.Event
    }
  }(), (e) => new Error(String(e)))
}

export const streamHandlers = HttpApiBuilder.group(StreamApi, "stream", (handlers) =>
  Effect.gen(function* () {
    return handlers.handleRaw("chatCompletions", (ctx) =>
      Effect.gen(function* () {
        const payload: any = yield* Effect.match(ctx.request.json, {
          onSuccess: (val) => val,
          onFailure: () => ({})
        })
        
        // Error out if missing messages to simulate required 400 for bad request logic without breaking the raw route setup
        if (!payload || !payload.messages) {
           return yield* Effect.fail(new InvalidRequestError({ message: "Missing messages" }))
        }

        // 1. Token Intake & 2. Prefill
        tokenize(payload?.messages)
        
        // 3. Decode loop (with Output ring backpressure implied by Effect Stream)
        const sseStream = decodeLoop(payload).pipe(
          Stream.pipeThroughChannel(Sse.encode()),
          Stream.encodeText
        )
        
        return HttpServerResponse.stream(sseStream, {
          contentType: "text/event-stream",
          headers: {
             "Cache-Control": "no-cache, no-transform",
             "X-Accel-Buffering": "no",
             "X-Content-Type-Options": "nosniff"
          }
        }) as any
      })
    )
  })
)
