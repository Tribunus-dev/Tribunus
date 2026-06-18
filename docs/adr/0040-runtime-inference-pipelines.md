# ADR 0040: Runtime Inference Pipelines

## Status
Proposed — June 2026

## Context

ADR 0034 defines the four-layer compiled inference model and 10 canonical compilation pipelines. ADR 0036 defines the arena/ring/lease memory substrate. What's missing is the runtime execution itself — how does a compute image actually run after compilation completes?

This ADR defines six deterministic runtime pipelines. Unlike the 10 compilation pipelines (which produce the compute image), these execute it. Each is a state machine over arena pages (ADR 0036) with defined sync points and receipt emission.

## Decision

### Pipeline 1: Token Intake

CPU-only pipeline. Tokenize input raw text using the compiled-in tokenizer (frozen into the compute image). Radix-tree prefix lookup (SGLang RadixAttention pattern) for shared prefixes across requests. Batch prefill requests. Allocate arena pages for embeddings.

**Backend:** CPU (tokenizer + radix tree)
**Receipt:** tokenization_time_us, prefix_cache_hit, prefix_cache_miss, batch_size, tokens_per_request
**Key difference from generic engines:** Tokenizer is a compute image artifact — no runtime model config parsing, no downloading.

### Pipeline 2: Prefill

Process prompt tokens via chunked flash attention (chunk size frozen per shape bucket at compile time). Fill KV pages in arena (write-once, consumed by decode). Produce first logit. Chunked prefill splits large prompts into smaller chunks to fit VRAM. Continuous batching: decode-first scheduling with prefill filling remaining token budget (vLLM V1 policy).

**Backends:** Apple Silicon: MLX Metal for large chunks (>128 tokens), CPU for small chunks. NVIDIA: CUDA Graphs capture for the prefill phase. AMD: Vulkan compute shaders.
**Sync point:** Prefill completes, KV pages write-once locked, decode begins.
**Receipt:** prefill_tokens, chunk_count, chunk_size, kv_pages_written, first_logit_latency_us

### Pipeline 3: Autoregressive Decode

The hot path. Per-token: gather KV (paged block table) → attention → MLP → logits. Uses precompiled CUDA Graphs (NVIDIA) or Metal indirect command buffers (Apple) — prequalified per batch family from the compute image. No runtime JIT, no allocation, no discovery. Weight-staging ring prefetch overlapped with attention compute (TensorRT-LLM pattern). Tree speculation integration (draft proposal overlapped with target decode via multi-stream).

**Backends:** All available GPU backends.
**Key difference from generic engines:** Every kernel is precompiled. No MLX JIT compilation during inference. CUDA Graphs replay across the steady-state decode loop with per-token KV page parameter updates.
**Receipt:** decode_step, tokens_per_step, kv_gather_us, attention_us, mlp_us, logits_us, total_us

### Pipeline 4: KV Management

Background pipeline running alongside decode. Append KV pages per token (paged block table, append-only). Tier migration based on compile-time policy (not runtime heuristics): hot → compressed (Tier 1 via TurboQuant INT4) → summarized (Tier 2 via KVQuant 2-bit). Speculative KV isolation via generation counters (not reference counting). SSD tier recall on Apple Silicon unified memory is viable at ~6 GB/s with no double-copy.

**Backends:** GPU for append. CPU for tier migration (compression is a background pass, runs after the decode is done for that token).
**Key difference from generic engines:** Migration policy is compiled, not improvised. The compute image declares when tiers should transition. Generation counters replace CoW reference counting for speculative isolation.
**Receipt:** pages_appended, pages_migrated, tier_transitions, compression_ratio, ssd_bytes_read

### Pipeline 5: Speculation

Multi-device pipeline unique to Tribunus. Three stages:
1. Draft proposal on ANE (8 MoE heads via Expert Proposal Fabric, fused MIL program)
2. CPU tree assembly (top-k selection from 8 proposals, tree attention mask construction)
3. GPU verifier (single batched forward pass via tree attention, accept longest branch, rollback rejected)

ANE → CPU → GPU synchronization via Metal shared events / CUDA timeline semaphores. Commit accepted KV pages via generation counter increment. Rollback rejected branches via atomic generation invalidation on speculative KV pages.

**Key difference from generic engines:** This is the only multi-device speculation pipeline in any inference engine. The ANE proposes, CPU assembles, GPU verifies — three backends cooperating on one logical phase.
**Receipt:** proposal_count, tree_width, tree_depth, acceptance_count, acceptance_rate, ane_us, cpu_assembly_us, gpu_verify_us, pages_committed, pages_rolled_back

### Pipeline 6: Output + Streaming

Logit processing on CPU via Accelerate (vDSP/vForce for temperature scaling, top-k/top-p filtering, repetition penalty). Vocabulary-sized vectors are GPU-overhead-bound — CPU is faster for this. Aho-Corasick automaton for multi-byte stop string detection (O(n+m) streaming, zero backtracking, 6+ GB/s). Incremental detokenization (token-by-token, never phrase-buffered). SSE streaming with backpressure via Output ring (ADR 0036 extension). Tool calling as first-class pipeline stage: detect tool call in output, pause generation, execute tool, re-inject result via arena.

**Backends:** CPU (Accelerate for logit processing, system for detokenization and streaming)
**Receipt:** sampling_algorithm, entropy, temperature, top_k, top_p, stop_condition_hit, tool_execution_outcome, backpressure_depth

### Sync Points

All pipeline sync via timeline semaphores (CUDA) or Metal shared events. No polling, no spin.

| From | To | Trigger | Mechanism |
|---|---|---|---|
| Prefill | Decode | First logit produced | Semaphore signal on KV page state |
| Speculation | Decode | Accept/rollback decision | Generation counter update |
| Decode | Output | Per-token logit | Logits ring push event |
| Decode | KV | Per-token append completed | KV ring slot state change |

## Consequences

**Positive:** Six pipelines replace ad-hoc execution. Each has a well-defined receipt schema. Multi-device speculation pipeline is unique to Tribunus — no other inference engine combines ANE + CPU + GPU for speculation.

**Negative:** Pipeline integration requires the arena/ring/lease runtime (ADR 0036) and receipt infrastructure to be stable first. Multi-device speculation pipeline requires all three backends to be present (ANE on Apple Silicon, GPU for verification).

**Effort:** 6-8 weeks for full pipeline integration once the substrate (arena, rings, leases, backends) is stable.
