const fs = require('fs')

let content = fs.readFileSync('packages/runtime/src/provider/transform.ts', 'utf8')

const target = `
// TODO: fix this stupid inefficient dogshit function
function normalizeMessages(
  msgs: ModelMessage[],
  model: Provider.Model,
  _options: Record<string, unknown>,
): ModelMessage[] {
  const sanitizeToolResultOutput = (content: ToolResultPart) => {
    if (content.output.type === "text" || content.output.type === "error-text") {
      content.output.value = sanitizeSurrogates(content.output.value)
    }
    if (content.output.type === "content") {
      content.output.value = content.output.value.map((item) => {
        if (item.type === "text") {
          item.text = sanitizeSurrogates(item.text)
        }
        return item
      })
    }
    return content
  }

  const isAnthropic = model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic"
  const isBedrock = model.api.npm === "@ai-sdk/amazon-bedrock"
  const isClaude = model.api.id.includes("claude")
  const isMistral = model.providerID === "mistral" || model.api.id.toLowerCase().includes("mistral") || model.api.id.toLocaleLowerCase().includes("devstral")
  const isDeepseek = model.api.id.toLowerCase().includes("deepseek")

  const useInterleavedField =
    typeof model.capabilities.interleaved === "object" &&
    model.capabilities.interleaved.field &&
    model.api.npm !== "@openrouter/ai-sdk-provider"
  const interleavedField = useInterleavedField ? (model.capabilities.interleaved as any).field : undefined

  const result: ModelMessage[] = []

  const scrubMistral = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "").substring(0, 9).padEnd(9, "0")
  const scrubClaude = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")

  for (let i = 0; i < msgs.length; i++) {
    let msg = { ...msgs[i] }
    const nextMsg = msgs[i + 1]

    // 1. Base sanitization & Scrubbing
    if (typeof msg.content === "string") {
      msg.content = sanitizeSurrogates(msg.content)
    } else if (Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        let newPart = { ...part }
        if (newPart.type === "text" || newPart.type === "reasoning") {
          (newPart as any).text = sanitizeSurrogates((newPart as any).text)
        }
        if (newPart.type === "tool-result") {
          newPart = sanitizeToolResultOutput(newPart as ToolResultPart)
        }

        if (isClaude && (newPart.type === "tool-call" || newPart.type === "tool-result")) {
          (newPart as any).toolCallId = scrubClaude((newPart as any).toolCallId)
        }

        if (isMistral && (newPart.type === "tool-call" || newPart.type === "tool-result")) {
          (newPart as any).toolCallId = scrubMistral((newPart as any).toolCallId)
        }

        return newPart
      })
    }

    // 2. Anthropic/Bedrock empty content filtering
    if (isAnthropic || isBedrock) {
      if (typeof msg.content === "string") {
        if (msg.content === "") continue
      } else if (Array.isArray(msg.content)) {
        const filtered = msg.content.filter((part) => {
          if (part.type === "text") return part.text !== ""
          if (part.type === "reasoning") {
            const hasText = part.text.trim().length > 0
            const hasAnthropicSignature = isAnthropic && (part.providerOptions?.anthropic?.signature != null || part.providerOptions?.anthropic?.redactedData != null)
            const hasBedrockSignature = isBedrock && (part.providerOptions?.bedrock?.signature != null || part.providerOptions?.bedrock?.redactedData != null)
            return hasText || hasAnthropicSignature || hasBedrockSignature
          }
          return true
        })
        if (filtered.length === 0) continue
        msg.content = filtered
      }
    }

    // 3. Deepseek reasoning filler
    if (isDeepseek && msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        if (!msg.content.some((part) => part.type === "reasoning")) {
          msg.content = [...msg.content, { type: "reasoning", text: "" } as any]
        }
      } else {
        msg.content = [
          ...(msg.content ? [{ type: "text", text: msg.content } as any] : []),
          { type: "reasoning", text: "" } as any,
        ]
      }
    }

    // 4. Interleaved Reasoning Field Extraction
    if (useInterleavedField && msg.role === "assistant" && Array.isArray(msg.content)) {
      const reasoningParts = msg.content.filter((part) => part.type === "reasoning")
      const reasoningText = reasoningParts.map((part) => part.text).join("")
      const filteredContent = msg.content.filter((part) => part.type !== "reasoning")

      msg.content = filteredContent
      msg.providerOptions = {
        ...msg.providerOptions,
        openaiCompatible: {
          ...msg.providerOptions?.openaiCompatible,
          [interleavedField]: reasoningText,
        },
      }
    }

    // 5. Anthropic tool-use reordering
    if (isAnthropic && msg.role === "assistant" && Array.isArray(msg.content)) {
      const parts = msg.content
      const first = parts.findIndex((part) => part.type === "tool-call")
      if (first !== -1 && parts.slice(first).some((part) => part.type !== "tool-call")) {
        result.push({ ...msg, content: parts.filter((part) => part.type !== "tool-call") })
        result.push({ ...msg, content: parts.filter((part) => part.type === "tool-call") })
        continue
      }
    }

    result.push(msg)

    // 6. Mistral Sequence Fix
    if (isMistral && msg.role === "tool" && nextMsg?.role === "user") {
      result.push({
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      })
    }
  }

  return result
}
`

const regex = /\/\/ TODO: fix this stupid inefficient dogshit function\nfunction normalizeMessages\(\n  msgs: ModelMessage\[\],\n  model: Provider\.Model,\n  _options: Record<string, unknown>,\n\): ModelMessage\[\] \{[\s\S]*?\n\}\n\nfunction applyCaching\(/m;

content = content.replace(regex, target + '\nfunction applyCaching(');

fs.writeFileSync('packages/runtime/src/provider/transform.ts', content);
