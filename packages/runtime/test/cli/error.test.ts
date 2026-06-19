      "Try: `tribunus models` to list available models",
      "Or check your config (tribunus.jsonc) provider/model names",
  test("formats ModelNotFound error correctly", () => {
    const data = {
      modelID: "gpt-4",
      suggestions: ["Qwen3-0.6B", "DeepSeek-V3", "llama-3.2-3b"]
    }
    const expected = "Model 'gpt-4' not found. Did you mean 'Qwen3-0.6B', 'DeepSeek-V3', 'llama-3.2-3b'? See tribunus search."
    expect(FormatError({ _tag: "ModelNotFound", ...data })).toBe(expected)
  })

  test("formats VRAMFull error correctly", () => {
    const data = {
      required_gb: 4.2,
      available_gb: 4.0,
      model: "llama-3.2-3b"
    }
    const expected = "VRAM full (4.2/4.0 GB). Try tribunus estimate llama-3.2-3b --quant q4_k_m, or tribunus unload llama-3.2-3b."
    expect(FormatError({ _tag: "VRAMFull", ...data })).toBe(expected)
  })

  test("formats BackendMissing error correctly", () => {
    const data = { backend: "Vulkan" }
    const formatted = FormatError({ _tag: "BackendMissing", ...data })
    expect(formatted).toMatch(/Vulkan not found\. Install: (brew install molten-vk|sudo apt install mesa-vulkan-drivers) \((macOS|Linux)\)\. See tribunus\.dev\/install\/(macos|linux)\./)
  })

  test("formats GPUNotFound error correctly", () => {
    const data = {
      detected: "AMD Radeon 5600M (Metal 2, 8GB)",
      using: "Metal"
    }
    const expected = "No NVIDIA GPU. Found: AMD Radeon 5600M (Metal 2, 8GB). Using Metal backend."
    expect(FormatError({ _tag: "GPUNotFound", ...data })).toBe(expected)
  })

  test("formats Timeout error correctly", () => {
    const data = {
      operation: "Decode",
      timeout_ms: 30000
    }
    const expected = "Decode timed out after 30s. Increase server.timeout_ms in tribunus.jsonc, or disable with server.timeout_ms: 0."
    expect(FormatError({ _tag: "Timeout", ...data })).toBe(expected)
  })

