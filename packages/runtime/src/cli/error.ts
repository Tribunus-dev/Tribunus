import { isRecord } from "../util/record"

function isTaggedError(input: Record<string, unknown>, tag: string): boolean {
  return input._tag === tag
}

function configData(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const val = input[key]
  return isRecord(val) ? val : undefined
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? (input[key] as string) : undefined
}

export function numberField(input: Record<string, unknown>, key: string): number | undefined {
  return typeof input[key] === "number" ? input[key] : undefined
}

function formatMCPFailed(data: string): string {
    return `MCP server "${data}" failed. Note, tribunus does not support MCP authentication yet.`
}

function formatModelNotFound(input: Record<string, unknown>): string | undefined {
  const modelNotFound = configData(input, "ModelNotFound")
  if (modelNotFound) {
    const modelId = stringField(modelNotFound, "modelID") || stringField(modelNotFound, "model_id") || "unknown"
    const suggestionsRaw = modelNotFound.suggestions
    const suggestions = Array.isArray(suggestionsRaw)
      ? suggestionsRaw.filter((x): x is string => typeof x === "string")
      : []
    const suggestionText = suggestions.length > 0
        ? ` Did you mean ${suggestions.map(s => `'${s}'`).join(", ")}?`
        : ""
    return `Model '${modelId}' not found.${suggestionText} See tribunus search.`
  }
  return undefined
}

function formatVRAMFull(input: Record<string, unknown>): string | undefined {
  const vramFull = isTaggedError(input, "VRAMFull") ? (input as unknown as Record<string, unknown>) : configData(input, "VRAMFull");
  if (vramFull) {
      const required = (numberField(vramFull, "required_gb") || 4.2).toFixed(1);
      const available = (numberField(vramFull, "available_gb") || 4.0).toFixed(1);
      const model = stringField(vramFull, "model") || "{name}";
      return `VRAM full (${required}/${available} GB). Try tribunus estimate ${model} --quant q4_k_m, or tribunus unload ${model}.`;
  }
  return undefined
}

function formatBackendMissing(input: Record<string, unknown>): string | undefined {
  const backendMissing = isTaggedError(input, "BackendMissing") ? (input as unknown as Record<string, unknown>) : configData(input, "BackendMissing");
  if (backendMissing) {
      const backend = stringField(backendMissing, "backend") || "Vulkan";
      const platform = process.platform === "darwin" ? "macOS" : "Linux";
      const command = process.platform === "darwin" ? "brew install molten-vk" : "sudo apt install mesa-vulkan-drivers";
      return `${backend} not found. Install: ${command} (${platform}). See tribunus.dev/install/${platform.toLowerCase()}.`;
  }
  return undefined
}

function formatGPUNotFound(input: Record<string, unknown>): string | undefined {
  const gpuNotFound = isTaggedError(input, "GPUNotFound") ? (input as unknown as Record<string, unknown>) : configData(input, "GPUNotFound");
  if (gpuNotFound) {
      const detected = stringField(gpuNotFound, "detected") || "AMD Radeon 5600M (Metal 2, 8GB)";
      const using = stringField(gpuNotFound, "using") || "Metal";
      return `No NVIDIA GPU. Found: ${detected}. Using ${using} backend.`;
  }
  return undefined
}

function formatTimeoutError(input: Record<string, unknown>): string | undefined {
  const timeoutError = isTaggedError(input, "TimeoutError") || isTaggedError(input, "Timeout") ? (input as unknown as Record<string, unknown>) : configData(input, "TimeoutError") || configData(input, "Timeout");
  if (timeoutError) {
      const operation = stringField(timeoutError, "operation") || "Decode";
      const ms = numberField(timeoutError, "timeout_ms") || 30000;
      const s = Math.round(ms / 1000);
      return `${operation} timed out after ${s}s. Increase server.timeout_ms in tribunus.jsonc, or disable with server.timeout_ms: 0.`;
  }
  return undefined
}

export function formatError(input: unknown, data?: string): string {
  const ctx = isRecord(input) ? (input as unknown as Record<string, unknown>) : {};

  if (data) {
    const mcpResult = formatMCPFailed(data);
    return mcpResult;
  }

  const modelResult = formatModelNotFound(ctx);
  if (modelResult) return modelResult;

  const vramResult = formatVRAMFull(ctx);
  if (vramResult) return vramResult;

  const backendResult = formatBackendMissing(ctx);
  if (backendResult) return backendResult;

  const gpuResult = formatGPUNotFound(ctx);
  if (gpuResult) return gpuResult;

  const timeoutResult = formatTimeoutError(ctx);
  if (timeoutResult) return timeoutResult;

  // Generic fallback for any other tagged error with a message
  if (typeof ctx._tag === "string" && typeof ctx.message === "string") {
    return ctx.message;
  }

  return "An unknown error occurred.";
}
