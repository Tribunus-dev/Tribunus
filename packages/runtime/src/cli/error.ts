function numberField(input: Record<string, unknown>, key: string): number | undefined {
  return typeof input[key] === "number" ? input[key] : undefined
}

  // MCPFailed
    return `MCP server "${data}" failed. Note, tribunus does not support MCP authentication yet.`
  // ModelNotFound
  const modelNotFound = configData(input, "ModelNotFound")
  if (modelNotFound) {
    const modelId = stringField(modelNotFound, "modelID") || stringField(modelNotFound, "model_id") || "unknown"
    const suggestionsRaw = modelNotFound.suggestions
    const suggestions = Array.isArray(suggestionsRaw)
      ? suggestionsRaw.filter((x) => typeof x === "string")
      : []
    let suggestionText = suggestions.length > 0
        ? ` Did you mean ${suggestions.map(s => `'${s}'`).join(", ")}?`
        : ""
    return `Model '${modelId}' not found.${suggestionText} See tribunus search.`
  }

  // ProviderModelNotFoundError
      `Try: \`tribunus models\` to list available models`,
      `Or check your config (tribunus.jsonc) provider/model names`,
  // VRAMFull
  const vramFull = configData(input, "VRAMFull") || isTaggedError(input, "VRAMFull") ? input as any : undefined;
  if (vramFull) {
      const required = (numberField(vramFull, "required_gb") || 4.2).toFixed(1);
      const available = (numberField(vramFull, "available_gb") || 4.0).toFixed(1);
      const model = stringField(vramFull, "model") || "{name}";
      return `VRAM full (${required}/${available} GB). Try tribunus estimate ${model} --quant q4_k_m, or tribunus unload ${model}.`;
  }
  
  // BackendMissing
  const backendMissing = configData(input, "BackendMissing") || isTaggedError(input, "BackendMissing") ? input as any : undefined;
  if (backendMissing) {
      const backend = stringField(backendMissing, "backend") || "Vulkan";
      const platform = process.platform === "darwin" ? "macOS" : "Linux";
      const command = process.platform === "darwin" ? "brew install molten-vk" : "sudo apt install mesa-vulkan-drivers";
      return `${backend} not found. Install: ${command} (${platform}). See tribunus.dev/install/${platform.toLowerCase()}.`;
  }

  // GPUNotFound
  const gpuNotFound = configData(input, "GPUNotFound") || isTaggedError(input, "GPUNotFound") ? input as any : undefined;
  if (gpuNotFound) {
      const detected = stringField(gpuNotFound, "detected") || "AMD Radeon 5600M (Metal 2, 8GB)";
      const using = stringField(gpuNotFound, "using") || "Metal";
      return `No NVIDIA GPU. Found: ${detected}. Using ${using} backend.`;
  }

  // Timeout
  const timeoutError = configData(input, "TimeoutError") || isTaggedError(input, "Timeout") || configData(input, "Timeout") ? input as any : undefined;
  if (timeoutError) {
      const operation = stringField(timeoutError, "operation") || "Decode";
      const ms = numberField(timeoutError, "timeout_ms") || 30000;
      const s = Math.round(ms / 1000);
      return `${operation} timed out after ${s}s. Increase server.timeout_ms in tribunus.jsonc, or disable with server.timeout_ms: 0.`;
  }

  
  // Generic fallback for any other tagged error with a message
  if (isRecord(input) && typeof input._tag === "string" && typeof input.message === "string") {
      return input.message;
  }

