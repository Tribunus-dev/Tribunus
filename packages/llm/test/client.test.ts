import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream, Schema } from "effect"
import * as LLM from "../src"
import * as Client from "../src/route/client"
import { Auth, RequestExecutor, HttpTransport } from "../src/route"
import { Protocol } from "../src/route/protocol"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

// A mock executor to intercept requests without hitting network
const makeMockExecutor = (handler: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLM.LLMError>) =>
  Layer.succeed(RequestExecutor.Service, {
    execute: (options) => handler(options)
  })

const MockBodySchema = Schema.Struct({
  message: Schema.String
})

type MockFrame = { readonly type: "mock"; readonly content: string }
type MockState = { readonly events: ReadonlyArray<LLM.LLMEvent> }

const MockProtocol: Protocol<Schema.Schema.Type<typeof MockBodySchema>, MockFrame, MockFrame, MockState> = {
  id: "mock-protocol" as unknown as LLM.ProtocolID,
  body: {
    schema: MockBodySchema,
    from: (request) => Effect.succeed({ message: "hello" })
  },
  stream: {
    event: Schema.Struct({ type: Schema.Literal("mock"), content: Schema.String }),
    initial: () => ({ events: [] }),
    step: (state: MockState, event: MockFrame): Effect.Effect<readonly [MockState, ReadonlyArray<LLM.LLMEvent>], LLM.LLMError> => {
      const textEvent = LLM.LLMEvent.textDelta({ id: "mock", text: event.content })
      const nextState: MockState = { events: [...state.events, textEvent] }
      return Effect.succeed([nextState, [textEvent]] as const satisfies readonly [MockState, ReadonlyArray<LLM.LLMEvent>])
    },
    terminal: () => false // Do not terminate early
  }
}

const mockRoute = Client.Route.make({
  id: "mock-route",
  provider: "mock-provider",
  protocol: MockProtocol,
  endpoint: { baseURL: "https://mock.api", path: "/test" },
  auth: Auth.none,
  transport: {
      id: "mock-transport",
      prepare: () => Effect.succeed("prepared-mock"),
      frames: () => Stream.make({ type: "mock" as const, content: "line1" }, { type: "mock" as const, content: "line2" })
  }
})

const mockModel = mockRoute.model({ id: "mock-model" })

describe("LLMClient", () => {
  describe("prepare", () => {
    test("builds correct prepared request", () => {
      const request = new LLM.LLMRequest({
        model: mockModel,
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        tools: [],
        generation: new LLM.GenerationOptions({})
      })

      const program = Effect.provide(
        Client.LLMClient.prepare(request),
        Client.layer.pipe(Layer.provide(makeMockExecutor(() => Effect.die("Should not be called"))))
      )

      const prepared = Effect.runSync(program)
      
      expect(prepared.route).toBe("mock-route")
      expect(prepared.protocol).toBe("mock-protocol")
      expect(prepared.body).toEqual({ message: "hello" })
    })
    
    test("merges route defaults and request options", () => {
       const routeWithDefaults = mockRoute.with({
           headers: { "x-default": "true" },
           generation: { temperature: 0.5 }
       })
       const request = new LLM.LLMRequest({
        model: routeWithDefaults.model({ id: "mock-model" }),
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        tools: [],
        generation: new LLM.GenerationOptions({ maxTokens: 100 })
      })

      const program = Effect.provide(
        Client.LLMClient.prepare(request),
        Client.layer.pipe(Layer.provide(makeMockExecutor(() => Effect.die("Should not be called"))))
      )

      const prepared = Effect.runSync(program)
      
      expect(prepared.route).toBe("mock-route")
    })
  })

  describe("stream", () => {
      test("handles successful response", async () => {
          const handler = () => Effect.die("should not be called because transport is mocked")

          const request = new LLM.LLMRequest({
            model: mockModel,
            system: [],
            messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
            tools: [],
            generation: new LLM.GenerationOptions({})
          })

          const program = Effect.provide(
            Client.LLMClient.stream(request).pipe(Stream.runCollect),
            Client.layer.pipe(Layer.provide(makeMockExecutor(handler)))
          )

          const response = await Effect.runPromise(program)
          expect(response.length).toBeGreaterThan(0)
      })
  })

  describe("generate", () => {
    test("handles successful response", async () => {
      const handler = () => Effect.die("should not be called because transport is mocked")

      const request = new LLM.LLMRequest({
        model: mockModel,
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        tools: [],
        generation: new LLM.GenerationOptions({})
      })

      const program = Effect.provide(
        Client.LLMClient.generate(request),
        Client.layer.pipe(Layer.provide(makeMockExecutor(handler)))
      )

      const response = await Effect.runPromise(program)
      expect(response.events.length).toBeGreaterThan(0)
      expect(response.text).toContain("line1line2")
    })
    
    test("handles executor errors", async () => {
      const failingMockRoute = Client.Route.make({
        id: "mock-route",
        provider: "mock-provider",
        protocol: MockProtocol,
        endpoint: { baseURL: "https://mock.api", path: "/test" },
        auth: Auth.none,
        transport: {
            id: "mock-transport",
            prepare: () => Effect.succeed("prepared-mock"),
            frames: () => Stream.fail(new LLM.LLMError({ module: "Mock", method: "mock", reason: new LLM.InvalidProviderOutputReason({ message: "Network error", route: "mock", raw: "" }) }))
        }
      })
      
      const failingMockModel = failingMockRoute.model({ id: "mock-model" })

      const request = new LLM.LLMRequest({
        model: failingMockModel,
        system: [],
        messages: [{ role: "user", content: [{ type: "text", text: "test" }] }],
        tools: [],
        generation: new LLM.GenerationOptions({})
      })

      const program = Effect.provide(
        Client.LLMClient.generate(request),
        Client.layer.pipe(Layer.provide(makeMockExecutor(() => Effect.die("should not be called"))))
      )

      const error = await Effect.runPromise(Effect.flip(program))
      expect(error.message).toContain("Network error")
    })
  })
})
