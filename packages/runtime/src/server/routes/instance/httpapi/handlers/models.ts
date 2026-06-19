import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { ModelsApi } from "../groups/models"

export const modelsHandlers = HttpApiBuilder.group(RootHttpApi, "models", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("listModels", () => Effect.succeed({ models: [] }))
      .handle("loadModel", () => Effect.succeed({ success: true }))
      .handle("unloadModel", () => Effect.succeed({ success: true }))
      .handle("health", () => Effect.succeed({ active_requests: 0, vram: 0, tok_s: 0 }))
  }),
)
