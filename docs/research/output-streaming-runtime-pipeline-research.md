# Output and Streaming Runtime Pipeline Research

## Summary
Comprehensive analysis of logit processing, detokenization/streaming, stop conditions, tool calling, and SSE backpressure patterns from vLLM, SGLang, llama.cpp, and TensorRT-LLM.

## Key Recommendations
1. Offload logit processing to Apple Accelerate on CPU (vDSP/vForce) — vocabulary-sized vectors are GPU-overhead-bound
2. Use Aho-Corasick automaton for multi-byte stop string detection — O(n+m) streaming, zero backtracking, 6+ GB/s
3. Detokenize token-by-token (incremental), never phrase-buffered
4. Tool calling as first-class pipeline stage with arena-level detection and re-injection
5. Output Ring (ADR 0036 extension) for backpressure between detokenization and SSE framing
6. Every stage emits Layer 3 receipts

## Pipeline Diagram
GPU Forward Pass → Logits Ring → CPU Logit Processing (Accelerate) → CPU Detokenization → [Text Stream | Tool Accumulator → Tool Execution] → Output Ring → SSE Framing → HTTP Response
