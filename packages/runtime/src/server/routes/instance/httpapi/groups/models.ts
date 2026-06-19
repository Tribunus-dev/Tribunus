import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"

export const ModelListSchema = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      backend: Schema.String,
      vram: Schema.Number,
      uptime: Schema.Number,
      tok_s: Schema.Number,
    })
  ),
})

export const ModelLoadPayload = Schema.Struct({
  name: Schema.String,
})

export const ModelUnloadPayload = Schema.Struct({
  name: Schema.String,
})

export const HealthSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  backend: Schema.optional(Schema.String),
  active_requests: Schema.Number,
  vram: Schema.Number,
  temperature: Schema.optional(Schema.Number),
  tok_s: Schema.Number,
})

export const ModelsApi = HttpApiGroup.make("models")
  .add(
    HttpApiEndpoint.get("listModels", "/api/v1/models", {
      success: ModelListSchema,
    }).annotateMerge(OpenApi.annotations({ summary: "List loaded models" })),
    HttpApiEndpoint.post("loadModel", "/api/v1/models/load", {
      payload: ModelLoadPayload,
      success: Schema.Struct({ success: Schema.Boolean }),
      error: HttpApiError.BadRequest,
    }).annotateMerge(OpenApi.annotations({ summary: "Load a model" })),
    HttpApiEndpoint.delete("unloadModel", "/api/v1/models/{name}", {
      path: Schema.Struct({ name: Schema.String }),
      success: Schema.Struct({ success: Schema.Boolean }),
      error: HttpApiError.NotFound,
    }).annotateMerge(OpenApi.annotations({ summary: "Unload a model" })),
    HttpApiEndpoint.get("health", "/api/v1/health", {
      success: HealthSchema,
    }).annotateMerge(OpenApi.annotations({ summary: "Health status" })),
  )
