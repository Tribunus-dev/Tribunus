# KV Cache Runtime Pipeline: Industry Patterns and Tribunus Recommendations

## Research Analysis — June 2026

This analysis surveys production inference systems (vLLM, SGLang, FlexGen, LMCache, ShadowKV, InfiniGen) and maps their KV cache management patterns onto Tribunus's compiled inference architecture (ADR 0034-0036, 0039). The goal is to identify which patterns transfer directly, which must be adapted, and where Tribunus's unique properties (pre-declared arenas, generation counters, typed rings) enable simpler or more correct designs.

---

## 1. Page-Based KV Cache: Block Tables and Prefix Sharing

### 1.1 vLLM PagedAttention

vLLM partitions the KV cache into fixed-size blocks (typically 16 tokens per block, storing K/V for all layers and heads). Each block occupies a contiguous GPU memory allocation, but blocks belonging to a logical sequence need not be contiguous. A per-request **block table** maps logical block positions to physical block addresses — exactly analogous to OS virtual memory page tables.

**Allocation**: Blocks are drawn from a global free pool on demand. When generation fills a block, a new physical block is allocated and appended to the block table. This eliminates external fragmentation: vLLM reports <4% memory waste vs. 60-80% in contiguous-allocation systems.

**Eviction**: Blocks with reference count zero (no active request holds them) are candidates. Among those, vLLM uses LRU, breaking ties by evicting blocks at the end of the longest prefix. When GPU memory is full, whole sequences can be preempted by swapping their block tables to CPU RAM — the blocks themselves stay in GPU memory (shared via CoW), and only the mapping is evicted.

**Prefix caching**: A global hash table maps block content hashes (SHA256 over tokens + prefix context) to physical block addresses. When a new request's prompt hashes match existing blocks, those physical blocks are reused via the block table — no recomputation needed. This is fully automatic and works across requests.

**Copy-on-write**: Multiple requests can share the same physical blocks through their block tables. A reference count tracks sharing. When a request diverges from the shared prefix, new physical blocks are allocated for the divergent tokens, while the shared prefix blocks remain referenced. Blocks return to the free pool only when reference count reaches zero.

### 1.2 SGLang RadixAttention

SGLang uses a **radix tree** instead of a hash table. Each node in the tree represents a token position in a prefix, with edges labeled by tokens. The tree naturally handles partial overlaps — two prompts that share "The cat sat" but diverge at "on"/"under" have a common internal node. The longest matching prefix is found by traversing the tree.

**Advantage over vLLM's hash-based approach**: Radix trees handle partial overlaps more flexibly. In multi-turn conversations where prompts change incrementally, SGLang can reuse sub-trees without recomputing the full shared segment. vLLM's hash-based approach requires exact block-aligned matches.

**HiCache extension**: SGLang layers a three-tier cache: L1 (GPU), L2 (host CPU RAM), L3 (distributed storage). This moves RadixAttention from a single-GPU optimization to a cluster-wide KV sharing primitive.

### 1.3 Relevance to Tribunus

Tribunus's **KV Ring** (ADR 0036) is a typed ring buffer of pre-declared arena pages with generation counters. This is fundamentally different from vLLM's dynamic allocation model. In Tribunus:

- **No dynamic allocation at inference time.** The compiled compute image declares KV ring size at compile time. Pages are pre-allocated, not drawn from a free pool.
- **No reference counting needed.** Generation counters provide ABA-protection: a stale (page_id, generation) pair is rejected at access time without needing to track how many request block tables reference a page.
- **Prefix sharing is a compiler concern, not a runtime concern.** The compiler can pre-populate a block table for known prefixes (system prompts, shared document contexts). At runtime, the block table is part of the compute image — not dynamically discovered via hashing.

**Recommendation**: Adopt block table indirection (logical blocks → physical pages) as the KV ring's addressing model. This allows the compiler to pre-declare prefix sharing in the compute image while the runtime simply follows the declared block table. Do NOT implement runtime hash-based prefix discovery — that's a compiler pass. For dynamic prefixes (multi-turn chat), provide a compiler re-invocation path that is fast enough for session start-up (target <50ms for block-table-only patches).

---

## 2. Multi-Tier KV Offload: GPU → CPU → SSD

### 2.1 Production Patterns

**FlexGen** (2023, Stanford/UC Berkeley): Pioneered GPU→CPU→SSD offloading for LLM inference. Uses linear programming to solve for optimal tensor placement across tiers. Compresses both weights and KV cache to 4-bit. Designed for throughput-oriented batch processing, not latency-sensitive interactive serving. Key insight: overlapping I/O with compute hides most of the SSD latency for large-batch workloads.

**LMCache** (2024-2025): Production-grade multi-tier KV cache system. Supports GPU HBM → CPU DRAM → NVMe SSD → remote storage tiers. Operates at chunk level (not full sequences). Uses predictive prefetching: when a chunk is accessed, nearby chunks are prefetched from slower tiers. Integrates as a plugin with vLLM and SGLang. Claims 8x throughput improvement for long-context workloads.

**ShadowKV** (late 2024, ICML 2025): Stores a low-rank key cache on GPU and offloads value cache to CPU. During decode, reconstructs minimal sparse KV pairs on-the-fly using an accurate KV selection strategy. Achieves 3x throughput on A100 without accuracy loss — effectively simulating infinite GPU memory.

**InfiniGen** (2024): For long-text generation, keeps full KV cache in CPU memory. Uses "ephemeral pruning" — speculates which KV entries the next attention layer will need, prefetches only those to GPU. Achieves 3x improvement over naive offloading systems.

**Mooncake** (Moonshot AI, 2024): KV cache-centric disaggregated architecture. Prefill and decode are split across nodes, with KV caches transferred via RDMA. Demonstrates that KV transfer latency can be hidden by pipelining.

### 2.2 Eviction Policies

| Policy | System | Mechanism |
|--------|--------|-----------|
| **LRU** | vLLM, LMCache | Default. Simple, effective for temporal locality. |
| **Attention-score-based** | H2O, SAGE-KV, CAOTE | Evict tokens with lowest cumulative or recent attention scores. H2O pioneered "heavy hitter" retention. |
| **Lagged Eviction** | LazyEviction (2025) | Tokens with temporarily low attention scores may become critical later. Delays eviction by a grace period. |
| **PagedEviction** | Research (2025) | Block-wise pruning that scores entire KV blocks, compatible with PagedAttention's non-contiguous layout. |
| **Compiler-hinted** | Tribunus (ADR 0035) | Compiler marks pages as sticky, disposable, or speculative. LRU score is combined with compiler hint. |

### 2.3 Recall Latency from Cold Tiers

| Tier | Latency (per retrieval) | Bandwidth | Use case |
|------|------------------------|-----------|----------|
| GPU HBM | ~ns (HBM3: ~3.35 TB/s) | 3.35 TB/s | Hot: current decode |
| CPU DRAM | ~10-50 ms (PCIe 5.0 x16) | ~64 GB/s | Warm: recently evicted, inactive sequences |
| CXL 3.0 | ~500 ns | ~45 GB/s | Overflow: beyond CPU DRAM capacity |
| NVMe SSD | ~100-500 ms (random) / ~6-50 GB/s (sequential, Apple Silicon) | 6-50 GB/s | Cold: historical context, archived sessions |

**Critical Apple Silicon distinction**: On Apple Silicon, NVMe reads land directly in unified memory — no double-copy from disk to GPU. This eliminates the PCIe round-trip entirely. SSD → unified memory is ~6 GB/s on M-series, making expert prefetching and KV recall from SSD viable at production latencies. FlashAttention-level prefetching (pre-loading KV blocks before the attention kernel needs them) can fully hide SSD latency when prefetch depth >= 4-6 blocks.

### 2.4 Relevance to Tribunus

Tribunus's **residency tier system** (ADR 0035) already defines MANDATORY → HOT → WARM → COLD tiers. The KV ring maps naturally:

- **Tier 0 (hot)**: Recent ~2048 tokens in FP8. Lives in KV Ring, always resident.
- **Tier 1 (compressed)**: Mid-context tokens in INT4 (TurboQuant/KIVI). Lives in KV Ring but occupies compressed pages.
- **Tier 2 (summarized)**: Distant context at 2-3 bits (KVQuant). May spill to WARM tier (backed by IOSurface/NVMe).

**Recommendation**: Tribunus's pre-declared arena model eliminates the need for runtime eviction policy sophistication. The compiler sizes each tier at compile time. The runtime only needs:
1. **Tier migration triggers**: When a page crosses the token-age threshold for its tier, the KV pipeline initiates compression and migration. This is declared in the compute image as a phase boundary.
2. **Prefetch depth**: The compiler can declare prefetch windows for SSD-backed KV pages based on expected decode speed and SSD bandwidth. No runtime heuristic needed.
3. **Eviction = page recycling with generation increment**: When a KV page is evicted, its generation counter is incremented and the page returns to the free list. No complex eviction scoring — the compiler pre-declares which pages are evictable and in what order.

This is simpler than vLLM's dynamic approach because Tribunus knows the full memory budget at compile time.

---

## 3. KV Compression Integration in the Decode Hot Path

### 3.1 Production Patterns

**KIVI** (ICML 2024): Tuning-free 2-bit asymmetric quantization. Keys are quantized per-channel, values per-token. Achieves 2.6x KV memory reduction with accuracy near the fp16 baseline. The implementation fuses dequantization into the attention kernel: quantized K/V blocks are loaded into shared memory, dequantized on-the-fly, and immediately consumed by the attention computation. No intermediate fp16 buffer. Influenced HuggingFace Transformers' KV cache quantization in June 2024.

**TurboQuant** (Google DeepMind, ICLR 2026): Two-stage algorithm (PolarQuant + Quantized Johnson-Lindenstrauss). Compresses KV cache to 3 bits with accuracy statistically indistinguishable from full precision on models up to 8B parameters. Claims 8x speedup vs. 32-bit keys on H100. No per-layer tuning required — uses random orthogonal rotation to de-correlate K/V before quantization.

**KVQuant** (2024, revised 2025): Per-channel key quantization, pre-RoPE key quantization (quantize before rotary embedding to preserve structure), non-uniform quantization, per-vector dense-and-sparse decomposition. Achieves 3-bit with <0.1 perplexity loss.

**SAW-INT4** (2025): Token-wise INT4 quantization with block-diagonal Hadamard rotation, designed specifically for paged KV cache layouts. Near-lossless accuracy without sacrificing serving efficiency.

### 3.2 Decompression: Fused vs. Separate Pre-Gather

Industry consensus is converging on **fused dequantization in the attention kernel**. KIVI, TurboQuant, and KVQuant all implement this pattern:

1. Compressed K/V blocks are stored in KV cache pages.
2. During attention computation, the kernel loads compressed blocks into registers/shared memory.
3. Dequantization happens inline — scale factors are loaded from per-block metadata, integer values are expanded to fp16/bf16, and the attention dot-product proceeds immediately.
4. No intermediate decompressed buffer is materialized.

For systems that cannot fuse (e.g., backends without custom attention kernels), a **pre-gather decompression step** is used: a separate kernel decompresses the needed KV blocks into a scratch buffer before the attention kernel runs. This is 2-3x slower in memory bandwidth but allows using standard attention implementations.

### 3.3 Relevance to Tribunus

Tribunus's **WeightCodec** interface (ADR 0035) already defines fused dequantize-matmul for weights. The same pattern extends to KV compression:

- **Compile time**: The compiler assigns per-layer KV compression codecs based on sensitivity profiling (attention layers get INT8/FP8, FFN KV gets INT4, early layers are more sensitive).
- **Runtime**: The attention backend's kernel signature includes a `dequant` flag. When a KV block is compressed, the kernel dispatches the fused dequantize-attention variant. When uncompressed, it dispatches the standard path.
- **Scratch ring fallback**: For backends that lack fused dequant kernels, decompression spills to the Scratch Ring (ADR 0036) — a pre-allocated ring buffer for temporary workspace.

**Recommendation**: Design the KV pipeline so that compressed pages carry a `compression_codec` field (analogous to the weight codec enum). The attention kernel selector reads this field and dispatches accordingly. The decompression gate sits **inside** the kernel dispatch boundary — not as a separate pipeline stage. This preserves the single-kernel-invocation property of the decode hot loop.

---

## 4. Speculative KV Isolation

### 4.1 Production Patterns

**vLLM speculative decoding**: When a draft model proposes tokens, vLLM generates provisional KV cache entries for those tokens. If the target model accepts, entries are promoted to committed. If rejected, entries are discarded and the KV cache rolls back to the last verified token. vLLM's block table with reference counting handles this: provisional blocks have reference count incremented, committed blocks are the authoritative state, and rollback decrements reference counts for rejected blocks.

**SGLang**: Allocates "independent cache slots per draft token" (provisional allocation). On acceptance, slots are merged into the main sequence's block table. On rejection, slots are freed. SGLang supports EAGLE-2/3, MTP, DFLASH, and standalone draft models — each with the same KV lifecycle pattern.

**Common pattern**: Both systems use the block table as the isolation boundary. Provisional KV pages are never in the authoritative block table — they exist in a separate "draft block table." Acceptance copies the block table entries (not the data) from draft to authoritative. Rejection frees the draft blocks.

### 4.2 The Tribunus Advantage

Tribunus's **Speculative KV Ring** and **generation counters** (ADR 0036) provide a cleaner isolation model:

- **Draft pages live in the Speculative KV Ring** — physically separate from the KV Ring.
- **State machine per slot**: `draft_reserved → draft_written → verifier_visible → accepted/rejected → generation_invalidated`.
- **On acceptance**: The block table pointer is updated to point to the speculative page, and the speculative page's generation is marked as committed. No data copy — the physical page changes logical ownership.
- **On rejection**: The generation counter is incremented (invalidating any outstanding handles), and the page returns to the free list. No data copy, no reference counting.
- **Isolation guarantee**: Speculative KV Ring pages have a different lease type (`verifier_commit`), preventing normal attention kernels from accidentally reading draft KV.

**Recommendation**: Tribunus's generation-counter approach is provably safer than vLLM's reference counting. Reference counting requires careful ordering (increment before use, decrement after use) and is vulnerable to use-after-free if ordering is wrong. Generation counters are check-then-use: the accessor validates (page_id, generation) at access time, and the counter is only invalidated when the page is recycled. This eliminates the entire class of stale-reference bugs.

---

## 5. Recommendations for Tribunus Runtime KV Pipeline

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    KV Pipeline                          │
│                                                         │
│  KV Ring (authoritative)                                │
│  ├─ Tier 0: FP8 hot pages (2048 recent tokens)          │
│  ├─ Tier 1: INT4 compressed pages (mid-context)         │
│  └─ Tier 2: 2-3 bit summarized (distant, WARM/SSD)     │
│                                                         │
│  Speculative KV Ring (isolated)                         │
│  ├─ Draft pages (provisional)                           │
│  └─ Verifier-visible pages                              │
│                                                         │
│  Block Table (per-request)                              │
│  ├─ Logical block → (physical_page_id, generation)      │
│  └─ Compiler-declared prefix sharing                    │
│                                                         │
│  Tier Migration Pipeline:                               │
│  ├─ Hot → Compressed: KIVI/TurboQuant encode pass       │
│  ├─ Compressed → Summarized: KVQuant aggressive pass    │
│  └─ Warm → Hot: Decompress on prefetch (fused kernel)   │
│                                                         │
│  Speculative Lifecycle:                                 │
│  ├─ Reserve → Write → Verify → Accept/Reject            │
│  └─ Generation counter invalidation on reject           │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Key Design Decisions

1. **Block table is compiler-declared, not runtime-discovered.** The compiler can pre-compute prefix sharing for known templates (system prompts). Dynamic sharing for multi-turn chat requires a fast compiler re-invocation (<50ms) that patches only the block table — not full recompilation.

2. **Tier migration is a phase boundary in the compute image.** The compiler emits KvCompress(tier_from, tier_to) phases at pre-declared token counts. The runtime executes these as deterministic fence-and-transform operations. No runtime heuristic decides when to compress — the compiler's sensitivity analysis pre-decides.

3. **Decompression is fused into the attention kernel.** No separate decompression stage. The kernel selector reads the page's `compression_codec` and dispatches the corresponding fused dequant-attention variant. For backends without fused kernels, decompression spills to the Scratch Ring — but this is a fallback, not the golden path.

4. **Generation counters replace reference counting for speculative isolation.** Acceptance promotes a page's logical ownership (block table update + generation commit). Rejection increments the generation counter (ABA protection) and returns the page to the free list. This is simpler, faster, and provably correct.

5. **No runtime eviction policy.** The compiler sizes each tier at compile time based on the model's context length, KV precision schedule, and available memory. The runtime follows the pre-declared eviction order: when a tier is full, the compiler-declared victim pages are recycled with generation increment.

### 5.3 What Tribunus Does NOT Need

- **Runtime hash-based prefix discovery**: This is a compiler optimization pass. The compute image declares which prefixes are shared.
- **Reference-counting garbage collection for KV pages**: Generation counters provide equivalent safety with lower complexity.
- **Dynamic allocation from a free pool**: Arenas are pre-sized. No malloc/free in the hot path.
- **Attention-score-based eviction heuristics**: The compiler's sensitivity analysis is more accurate and runs offline.
- **LRU eviction policy**: Compiler hints (sticky/disposable/speculative) combined with pre-declared tier sizes eliminate the need for runtime heuristics.

### 5.4 Open Questions

1. **Dynamic prefix caching for multi-turn chat**: Can the compiler re-invocation path for block-table-only patches meet the <50ms target? This likely requires pre-compiled "prefix templates" that the runtime can instantiate without full recompilation.

2. **Cross-engine KV format standard**: ADR 0039 identifies this as Phase 4 effort (3-4 weeks). If Tribunus wraps vLLM/SGLang as execution substrates, the KV format needs interop. A minimal standard would specify: page size, dtype per tier, compression codec, block table layout, and hash function.

3. **SSD recall latency on Apple Silicon vs. discrete GPU**: Apple Silicon's unified memory eliminates the double-copy, making SSD → GPU transfer ~6 GB/s with ~50-100 μs access latency. This is fast enough that aggressive KV summarization (Tier 2) may be unnecessary on Apple Silicon — keep everything in Tier 0/1 if the model fits. On discrete GPUs with PCIe bottlenecks, Tier 2 summarization is essential.

4. **Per-layer KV bit allocation sensitivity profiling**: ADR 0035 mentions this as a compiler pass, but the specific methodology (activation-aware? gradient-based? heuristic?) is not yet specified. KIVI's finding that early layers are more sensitive (AsymKV) provides a starting heuristic.

---

## References

- vLLM PagedAttention: Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention," SOSP 2023
- SGLang RadixAttention: Zheng et al., "SGLang: Efficient Execution of Structured Language Model Programs," NeurIPS 2024
- KIVI: Liu et al., "KIVI: A Tuning-Free Asymmetric 2bit Quantization for KV Cache," ICML 2024
- TurboQuant: Google DeepMind, "TurboQuant: Extremely Low-Bit KV Cache Quantization," ICLR 2026 (forthcoming)
- KVQuant: Hooper et al., "KVQuant: Towards 10 Million Context Length LLM Inference with KV Cache Quantization," 2024
- ShadowKV: Sun et al., "ShadowKV: KV Cache in the Shadows for High-Throughput Long-Context LLM Inference," ICML 2025
- LMCache: "LMCache: An Efficient KV Cache Layer for Enterprise-Scale LLM Inference," 2025
- InfiniGen: "InfiniGen: Efficient Generative Inference of Large Language Models with Dynamic KV Cache Management," 2024
- FlexGen: Sheng et al., "FlexGen: High-Throughput Generative Inference of Large Language Models with a Single GPU," ICML 2023
- H2O: Zhang et al., "H2O: Heavy-Hitter Oracle for Efficient Generative Inference of Large Language Models," NeurIPS 2024
- SAW-INT4: "System-Aware 4-bit KV Cache Quantization for Efficient LLM Inference," 2025
