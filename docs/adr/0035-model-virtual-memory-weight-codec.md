# ADR 0035: Model Virtual Memory and Weight Codec Architecture

## Status
Proposed — June 2026

## Context

Tribunus Compute's compiled inference architecture (ADR 0034) separates assessment, compilation, execution, and receipts but intentionally left weight format, memory hierarchy, and KV compression unspecified. As we target models from 0.5B to 1.6T parameters, these become binding constraints:

- A 0.5B model fits in 1 GB at fp16. DeepSeek V4-Pro 1.6T at INT4 is ~335 GB compressed — requiring tiered weight paging even on a 512 GB M3 Ultra.
- KV cache grows linearly with context. At 1M tokens, DeepSeek V3's KV cache is ~160 GB — competing directly with weight memory.
- Attention layers are 3-5x more sensitive to quantization than FFN layers. MoE experts vary 10-100x in importance. One codec does not fit all.

Research completed on weight quantization (6 method families), model virtual memory (page table + residency), KV cache compression (TurboQuant/KIVI/KVQuant), MoE expert paging (Fate 99% hit rate), and speculative decoding integration.

## Decision

Adopt a three-pillar architecture for weight compression, model virtual memory, and KV cache management, integrated into the ADR 0034 compiled inference model. Every decision is designed for compile-time specialization.

### Pillar 1: Weight Codec Interface

Define a `WeightCodec` enum — every weight tensor carries its codec in the compute image:

- **Identity**: fp16/bf16 (no compression). For embedding tables, LM head, routers.
- **GroupQuantized**: INT4 or INT8, group size 128, with optional AWQ scaling. Workhorse codec for 4-bit inference across all backends. Marlin kernel on NVIDIA, MLX/TinyChat on Apple, ROCm port on AMD.
- **RotationQuantized**: QuaRot/SpinQuant-style rotation + group quantization. Fuses rotation into the preceding op; inner format is still GroupQuantized. Future use.
- **CodebookQuantized**: AQLM-style additive codebook for 2-3 bit cold experts. Reference CUDA kernels exist; production integration deferred.

**Execution rule:** Default is fused dequantize-matmul (never materialize fp16). Fallback is decompress-on-load for backends without fused kernels. Compiler marks execution mode per page.

**Per-layer assignment:** The compiler's assessment phase solves a knapsack — maximize quality given memory budget. Per-expert precision allocation for MoE: router in BF16, shared expert in INT8, hot routed experts in INT4, cold experts in INT4 with 3-bit codebook (future).

### Pillar 2: Model Virtual Memory

**Weight paging:** Every weight tensor is partitioned into self-describing pages (64 KB for dense layers, 256 KB for expert FFN blocks). Each page carries: page_id, dtype, layout, checksum, residency_tier, backend_compatibility, load_cost, predicted_next_use.

**Residency tiers:**

- **MANDATORY**: Always resident. Embeddings, norms, router, output head. Never paged.
- **HOT**: Arena with prefetch. Dense attention projections, frequent experts. Evicted via LRU + compiler hints.
- **WARM**: Disk-backed. Cold experts. Loaded on demand via async NVMe read.
- **COLD**: Not loaded. Unused model snapshots.

**Page fault handling:** Lane stalls, issues async disk read, decompresses if needed (fused execution avoids decompression), updates page table, lane resumes. MANDATORY page faults are fatal (compilation bug).

**Prefetch:** Sequential (dense layers: prefetch K=1 ahead), router-predicted (MoE experts: Fate-inspired cross-layer gate prediction achieves 97.15% accuracy, 99.08% cache hit rate), temporal-reuse (pages accessed multiple times per token).

**Eviction:** LRU + compiler eviction classes (sticky, disposable, speculative). Score = recency + compiler_hint + reuse_penalty.

**Apple Silicon advantage:** No double-copy from disk to GPU — NVMe reads land directly in unified memory. Expert paging from NVMe is viable at ~6 GB/s with 22-layer prefetch depth.

### Pillar 3: KV Cache Compression

**Multi-tier KV cache:**

- **Tier 0 (hot):** Recent K tokens (default 2048) in FP8. Near-lossless.
- **Tier 1 (compressed):** Mid-context tokens in INT4 via TurboQuant (3.5 bits, <0.1 perplexity loss). Per-channel keys, per-token values (KIVI pattern).
- **Tier 2 (summarized):** Distant context at 2-3 bits via KVQuant. Per-layer bit allocation based on sensitivity.

**Per-layer KV precision:** Attention layers get more bits (INT8/FP8). FFN KV gets fewer bits (INT4). Early layers are more sensitive (AsymKV finding).

**KV compression and speculation:** Draft KV is provisional — committed on branch acceptance, discarded on rejection. CoW block tables (PagedAttention-style) make rollback zero-copy.

### Model Scaling Ladder

| Model | Size | Target hardware | Strategy |
|---|---|---|---|
| Qwen 0.5B | <1 GB any dtype | Any Apple Silicon | Identity codec, all resident |
| GPT-OSS 20B | ~10 GB INT4 | M-series laptops, 16 GB | GroupQuantized INT4, all resident |
| GPT-OSS 120B | ~60 GB INT4 | M5 Max 128 GB | GroupQuantized INT4 + KV Tier 1 |
| DeepSeek V3 671B | ~335 GB INT4 | M3 Ultra 512 GB | GroupQuantized, expert paging (WARM) |
| DeepSeek V4-Flash 284B | ~142 GB INT4 | M3 Ultra (comfortable), M5 Max (3-bit) | GroupQuantized INT4 or 3-bit codebook |
| DeepSeek V4-Pro 1.6T | ~800 GB INT4 | M3 Ultra + expert paging | GroupQuantized + codebook for cold experts |
| Models > VRAM | Any | Any discrete GPU | Model VM with WARM tier on host RAM + disk |

## Consequences

### Positive

- Deterministic weight loading — runtime never discovers formats or decompresses on the fly
- Per-layer codec assignment uses every memory bit efficiently
- Same architecture handles 0.5B to 1.6T models
- Apple Silicon unified memory exploited fully (no double-copy, fused dequant)
- KV compression is compositional — tiers cover full context profile
- Every page fault, prefetch, decompress is receipt-verifiable
- Speculative decoding draft pages are tagged and evicted on rejection

### Negative

- Each codec format requires fused dequant kernels per backend. Initial ship: 2 codecs (Identity, GroupQuantized). Codebook kernels deferred.
- Page table overhead (~333 MB at 64 KB pages) is manageable on 512 GB but tight on 16 GB devices
- Compilation time increases by minutes for knapsack solver and sensitivity profiling
- KV tier migration adds runtime complexity
- Residency contract is hardware-specific — must re-run assessment per target

### Estimated Effort

| Component | Timeline |
|---|---|
| WeightCodec + Identity/GroupQuantized codecs | 2 weeks |
| Compile-time encoding pass | 1 week |
| Residency contract compiler pass | 1 week |
| Page manager runtime + page faults | 2 weeks |
| Prefetch engine (sequential + router) | 2 weeks |
| Eviction engine (LRU + hints) | 1 week |
| Paging receipts + aggregation | 1 week |
| KV cache multi-tier (Tier 0/1) | 1 week |
| KV cache aggressive (KIVI/KVQuant kernels) | 2-3 weeks |
| Per-layer sensitivity profiling | 1 week |
| Knapsack solver for codec assignment | 1 week |
| **Total** | **15-17 weeks** |
