# Canonical Compilation Pipelines for Portable Inference: Research Summary and Tribunus Implementation Order

**Status:** Research Report — June 2026
**Target:** Apple Silicon (ANE, MLX Metal, Accelerate), with portable extension to AMD, Intel, NVIDIA, Tenstorrent

---

## Executive Summary

This report maps 10 canonical compilation pipelines to existing compiler research (TVM, MLIR, TensorRT, Halide, vLLM, FlashAttention, SpecInfer, etc.) and recommends an implementation order for the Tribunus Compute compiler. Each pipeline is described as a compiler pass or family of passes that produces a specific artifact in the compute image. The 10 pipelines collectively transform a model and hardware into a deterministic, receipted, precompiled executable — the Tribunus golden path.

The recommended implementation order is driven by dependency structure: pipelines 1 and 2 (weight ingestion and shape assessment) produce inputs consumed by all downstream passes. Pipeline 3 (canonical phase lowering) produces the execution graph that pipelines 4, 5, 6, 7, and 8 schedule against. Pipeline 9 (model virtual memory) is designed in ADR 0035 and is a prerequisite for large-model support. Pipeline 10 (receipts) is a cross-cutting concern enabled from day one, not added later.

---

## Pipeline 1: Weight Ingestion and Compression

### What it does

Ingests model weights from safetensors, GGUF, or raw PyTorch checkpoints. Normalizes tensor names across formats. Infers model architecture (LLaMA, Qwen, DeepSeek, etc.) from parameter shapes and naming conventions. Assigns per-layer codecs (Identity, GroupQuantized, RotationQuantized, CodebookQuantized). Packs weight pages with checksums and self-describing headers. Generates fused dequantize-matmul kernel handles. Defines residency tier assignments (MANDATORY, HOT, WARM, COLD) per ADR 0035.

### Citations and existing compiler precedents

**TVM Relay Import (Apache TVM):** The Relay frontend ingests models from ONNX, PyTorch, TensorFlow, and TFLite. It normalizes the graph into Relay IR, maps operations to TVM operators, and annotates each tensor with shape, dtype, and layout. TVM's `tvm.relay.frontend` does exactly what Tribunus needs at the graph level — but TVM defers quantization to a separate pass (`tvm.relay.transform.quantize`), while Tribunus binds codecs at ingestion time based on compile-time assessment.

**TensorRT Weight Binding (NVIDIA):** TensorRT's `IBuilder` ingests ONNX or TensorFlow graphs and maps weights to execution contexts. The weight binding phase assigns each weight tensor a memory location, format (FP16, INT8, INT4), and execution engine handle. TensorRT's `IInt8Calibrator` and `IInt8EntropyCalibrator` run the calibration needed for quantization decisions — analogous to Tribunus' codec assignment solved by a knapsack solver (ADR 0035 Section 8.3).

**MLIR Weight Quantization Pass (Google/LLVM):** The `mlir::quant::QuantizeCast` and related passes in MLIR's Quant dialect lower floating-point operations to quantized integer arithmetic. MLIR separates the quantization *decision* from the quantization *lowering* — the dialect defines quantization parameters per tensor, and later passes lower to integer ops. Tribunus takes a more integrated approach: the codec is assigned at ingestion and baked into the compute image, never discovered at runtime.

**GGUF / llama.cpp:** The GGUF format is a self-describing binary format where each tensor carries its quantization type (`q4_0`, `q4_K_M`, `q8_0`, etc.), shape, and offset. The model loader maps tensor names to memory regions. This is the most similar format to what Tribunus needs: a self-describing weight page with codec, checksum, and residency metadata.

### Tribunus current state

ADR 0035 defines the WeightCodec interface, encoding pass, and knapsack solver. ADR 0034 specifies the weight compression pipeline as a Layer 1 compilation pass. Research at `docs/adr/0035-weight-quantization-codec-research.md` surveys six method families and provides kernel support matrices for Apple Metal, CUDA, ROCm, and Vulkan. The GroupQuantized codec (INT4/INT8, group size 128, AWQ scaling) is the recommended workhorse codec. CodebookQuantized is deferred.

### Key design decisions for Tribunus

- **Per-layer, not per-model codec assignment.** The compiler's assessment phase profiles each layer's sensitivity (ADR 0035 Section 8.3) and assigns codecs via a knapsack solver that maximizes quality given memory budget.
- **Page-granularity compression.** Every 64 KB (dense) or 256 KB (expert FFN) page is self-describing: page_id, dtype, layout, checksum, residency_tier, codec, decode_kernel_handle.
- **Fused dequantize-matmul is the default execution mode.** Decompression-to-fp16 is a fallback for backends without fused kernels.
- **Per-expert MoE calibration.** AWQ calibration must be run per-expert, not shared across experts, because each expert sees different activation distributions due to routing divergence.

---

## Pipeline 2: Shape and Topology Assessment

### What it does

Discovers model dimensions (d_model, n_heads, n_layers, vocab_size, intermediate_size), sequence regime (prefill-bound vs decode-bound), dtype options, quantization layout requirements, optimal page sizes for the target hardware, GPU family capabilities, Core ML behavior on the current device, Accelerate framework version and AMX availability, memory bandwidth class, and thermal/power characteristics. Produces a machine profile — the hardware truth that all downstream passes optimize against.

### Citations and existing compiler precedents

**TVM Target (Apache TVM):** TVM's `tvm.target.Target` abstraction encodes the target hardware as a string with capabilities: `"metal -max_threads_per_threadgroup=1024 -max_total_threadgroup_memory=32768"`. TVM AutoTVM and Ansor use the target string plus a hardware description to tune kernel parameters (thread block size, unroll factors, vectorization width). The target is the canonical representation of "what this hardware can do."

**MLIR Data Layout (Google/LLVM):** MLIR's DataLayout dialect defines type sizes, alignments, and preferred alignments for each target. Combined with the Target dialect, it enables lowering passes to make layout decisions (row-major vs column-major, tiled vs linear) based on hardware constraints.

**HWCatalog (various auto-tuners):** Auto-schedulers maintain a hardware catalog that maps device names to measured characteristics: peak FLOPS, memory bandwidth, cache sizes, SIMD width, optimal tile sizes, register file pressure limits. TVM's Meta-Schedule and Halide's auto-scheduler both use hardware catalogs to prune the search space of candidate implementations.

**Core ML Profiling (Apple):** `coremltools.utils.profiling` measures actual model execution time per layer on real hardware. `coremltools.optimize` provides `OpLinearQuantizer` and `OpPalettizer` that use these measurements. Tribunus needs a superset: not just per-layer latency, but per-phase, per-backend, per-dtype, per-batch-size.

**llama.cpp Hardware Detection:** `llama.cpp` detects Apple Silicon via `sysctl` (CPU core count, GPU core count, memory bandwidth) and configures Metal threadgroup sizes and GQA ratios accordingly. This is the simplest working model: a handful of sysctl calls that determine deployment parameters.

### Tribunus current state

The `golden-path-plan.v1.json` schema includes `machine_profile` with fields for `device_class`, `memory_bandwidth_bytes_per_sec`, `gpu_core_count`, `ane_core_count`, `unified_memory_bytes`, `max_metal_threadgroup_size`, `supports_bfloat16`, `supports_int8_matmul`, `supports_fp8_matmul`, and a `gpu_family` enum. ADR 0034's Layer 0 (Assessment) describes the concept: backends declare capabilities, benchmarks measure actual behavior, the machine profile freezes the measured truth.

### Key design decisions for Tribunus

- **Assessment runs during compilation, never during inference.** The machine profile is frozen into the compute image. Runtime reads it — never discovers hardware anew.
- **Per-backend capability certificates.** Each backend (MLX Metal, Core ML, Accelerate, future Vulkan, etc.) self-declares capabilities via a `BackendCapability` schema (`schemas/backend-capability.v1.json`). Gaps are declared, not silently discovered.
- **Benchmark-driven truth.** The compiler runs microbenchmarks: matmul of known dimensions on each backend, attention score at typical sequence lengths, softmax kernel variants. Winners are measured, not estimated.
- **Shape polymorphism handling.** For models with variable batch or sequence dimensions, the assessment profiles at multiple shape points and the compiler emits a shape dispatch table. Unknown shapes at runtime trigger a compile-time shape class if precomputed, or fallback if not.

---

## Pipeline 3: Canonical Phase Lowering

### What it does

Lowers every supported model architecture into a common set of canonical inference phases. The phases are: embed, norm, attention qkv projection, RoPE application, KV cache append, attention score computation, attention softmax, attention value aggregation, output projection, residual connection, MLP gate/up/down projections, logits projection, sampling, and commit. For MoE models, additional phases: route, expert gate dispatch, expert execute, expert combine. The output is a phase graph — a DAG where each node is a canonical phase with known inputs, outputs, shapes, and dtypes.

### Citations and existing compiler precedents

**MLIR Dialect Lowering (Google/LLVM):** The heart of MLIR: a high-level dialect (e.g., `tosa.matmul`, `linalg.generic`) is progressively lowered through intermediate dialects to a target dialect (e.g., `gpu.launch`, `spirv.module`). Each lowering pass replaces ops from one dialect with equivalent ops in a lower dialect. The key insight: the lowering path is a directed acyclic graph of dialect conversions, and the compiler can select different lowering paths for different targets.

**TOSA (Tensor Operator Set Architecture, MLIR):** TOSA defines a fixed set of ~130 operators at a "low enough" level that hardware backends can target directly, but "high enough" that frameworks can lower to it without loss. TOSA is the closest existing analog to Tribunus' canonical phases: a deliberately limited, stable opset designed for multi-backend lowering. TOSA's `tosa.matmul`, `tosa.fully_connected`, `tosa.attention` correspond to Tribunus' qkv_projection, output_projection, attention_score phases.

**ONNX Opset (ONNX Runtime):** ONNX defines ~200 operators. Each backend (CUDA, TensorRT, OpenVINO, DirectML, Core ML) implements a subset. ONNX Runtime's execution provider model picks the best backend per op. The ONNX opset is larger and less inference-optimized than TOSA but serves the same function: a common IR that backends target.

**IREE (Google/Community):** IREE lowers from MLIR through multiple dialects (Linalg → Vector → GPU → SPIR-V/Metal) to produce executable code for CPU, GPU, and specialized accelerators. IREE's compilation flow is: frontend IR → host-level scheduling → device-level code generation. The `iree-flow` dialect defines execution regions, and `iree-hal` maps them to hardware abstraction layer commands.

**Apache TVM Relay ops:** Relay defines core tensor ops (nn.conv2d, nn.dense, nn.softmax, nn.batch_norm) that are lowered to TE (Tensor Expression) or directly to TIR (Tensor IR) schedules. TVM keeps the opset relatively stable and backend-specific lowering in separate passes.

### Tribunus current state

`research/docs/pipeline-stages.md` defines 42 pipeline stages covering initialization (1–7), per-token decode (8–38), and teardown (39–42), with 11 execution substrates (cpu_scalar through coreml_ane). The canonical phases map to stages 9–36: embedding_gather, input_normalization, q/k/v_projection, rope_application, attention_score through attention_value, output_projection, mlp_gate/up/down_projection, final_normalization, vocabulary_projection, sampling. MoE phases (route, expert dispatch) are implied but not yet enumerated as separate stages.

### Key design decisions for Tribunus

- **The phase set is deliberately limited.** Each phase corresponds to one meaningful operation in the transformer architecture. There is no "fused_dot_product_attention" phase — that is the concern of pipeline 6 (fusion).
- **Phases have strict contracts:** declared inputs (tensor IDs from the island), declared outputs (tensor IDs to commit), declared shapes, declared dtypes, declared residency requirements, declared latency budget.
- **The phase graph is static for a given model.** Shape polymorphism (batch, sequence) is handled at the dispatch table level (pipeline 2), not by constructing the phase graph at runtime.
- **New models add phases, not modify existing ones.** The phase set is extensible via additive versioning (pipeline-stages.md v2 adds MoE-specific stages) but existing phases never change semantics.

---

## Pipeline 4: Backend Candidate Generation

### What it does

For each canonical phase, generates multiple candidate implementations across available backends: MLX graph (lazy Metal JIT), custom Metal kernels (precompiled, device-specialized), Core ML MIL islands (fused subgraphs compiled to ANE or GPU), Accelerate recipes (chained vDSP/BLAS/LAPACK/BNNS), and Rust scalar fallback. Each candidate is compiled to an executable artifact and benchmarked during assessment. Winners are frozen into the compute image. Losers are recorded for fallback chains.

### Citations and existing compiler precedents

**TVM Ansor (Apache TVM):** Ansor is TVM's auto-scheduler that generates candidate tensor programs through a hierarchical search: (1) a sketch generator proposes high-level computation structures (tiling, vectorization, unrolling patterns), (2) an evolutionary search refines the sketches into complete schedules, (3) a cost model (trained XGBoost) predicts performance, (4) actual measurement on hardware validates the top candidates. Ansor demonstrates the core loop Tribunus needs: propose candidates → benchmark → freeze winners.

**Halide Auto-Scheduler (MIT/Google):** Halide's auto-scheduler (2019 Li et al.) generates schedules by searching over tiling, vectorization, and parallelism parameters using beam search with a learned cost model. Halide separates "algorithm" (what to compute) from "schedule" (how to compute it) — exactly the Tribunus model of "canonical phase" (what) vs "backend candidate" (how).

**TensorRT IBuilder (NVIDIA):** `IBuilder` with `IBuilderConfig` generates optimized engine plans by enumerating tactic combinations: which kernel implementation for each layer (cuBLAS, cuDNN, TensorRT plugin), which precision (FP32, FP16, INT8), which memory layout (NHWC, NCHW). Tactics are selected by a combination of heuristics and timing measurements via `IExecutionContext.setProfilingVerbosity`.

**MLX Custom Kernel (Apple):** MLX's `mx.fast.custom_function` and `mx.compile()` enable user-defined Metal kernels registered as MLX primitives. MLX evaluates them lazily alongside native ops, allowing graph-level optimization across custom and built-in ops. Tribunus forks MLX (ADR 0034) to gain authority over: evaluation scheduling, output placement, allocator behavior, compiled-kernel cache, and IOSurface ownership.

**Burn/CubeCL (Tracel AI):** CubeCL compiles a single `#[cube]` kernel to CUDA, HIP, Metal, Vulkan/SPIR-V, WebGPU/WGSL, and CPU SIMD. This is the portable kernel abstraction Tribunus needs for multi-backend candidate generation. CubeCL is alpha but production-grade in Burn 0.21.

### Tribunus current state

ADR 0034 defines the assessment and compilation layers: backend candidates compete during compilation, winners are frozen into the compute image. ADR 0019 defines the backend routing surface (Metal first, CUDA/HIP/oneAPI/Vulkan sequentially). The `golden-path-plan.v1.json` schema includes `backend_artifacts` with kernel hashes and `dispatch_table` entries mapping phases to backend lanes with fallback chains.

The MLX fork is justified in ADR 0034: required changes are below MLX's public abstraction layer (evaluator scheduling, output placement, allocator behavior, compiled-kernel cache, IOSurface ownership). The fork remains narrow — it makes MLX obey the compute image's authority without becoming a long-term maintenance black hole.

### Key design decisions for Tribunus

- **Candidates are generated per-phase, not per-op.** A "candidate" is a complete implementation of a canonical phase (e.g., "attention score for sequence length 128 on MLX Metal") with all inputs and outputs declared.
- **Legal fallbacks are compiled, not improvised.** The dispatch table includes fallback chains per phase: preferred backend, one or two fallbacks, scalar CPU final backstop.
- **CubeCL as the kernel generation layer for custom Metal.** Rather than writing Metal Shading Language directly for every kernel, use CubeCL's `#[cube]` macro to target Metal from Rust, gaining portability to CUDA/HIP as backends are added.
- **Core ML candidates are not individual ops.** They are fused MIL islands (see pipeline 6) large enough to amortize boundary costs. The compiler benchmarks different fusion boundaries.

---

## Pipeline 5: Arena Planning

### What it does

Determines page classes (64 KB dense, 256 KB expert FFN), ring buffer sizes for inter-phase transport, lease transition rules (read-only, read-write, exclusive, shared), producer-consumer dependency chains (which phases produce tensors consumed by which subsequent phases), scratch budget for temporary allocations during phase execution, KV cache budget (total, per-layer, per-tier), speculative decode provisional page budget, weight residency tiers (MANDATORY, HOT, WARM), and purge policy (when pages can be recycled). Emits an arena manifest — the complete memory budget for the entire inference session.

### Citations and existing compiler precedents

**vLLM PagedAttention (UC Berkeley):** vLLM partitions the KV cache into fixed-size blocks (16 tokens each), managed by a block table. This virtualizes KV cache memory: logical KV cache positions map to physical blocks, and blocks can be shared across sequences (beam search, parallel decoding). The block manager tracks free/allocated blocks, handles CoW for write operations, and supports pre-allocation for prefill. Tribunus extends this model from KV cache only to *all* inference memory: weight pages, activation buffers, scratch arenas, speculative pages, and KV cache blocks.

**CUDA Memory Management (NVIDIA):** `cudaMallocAsync` with CUDA memory pools provides stream-ordered allocation with deferred free semantics — allocations and deallocations are ordered relative to stream execution, eliminating most synchronization. `cudaMemPool` supports trim, attribute query, and import/export. CUDA Graphs capture and replay the memory allocation graph alongside computation. Tribunus' arena planning is this concept applied to the full compute image, not just GPU memory.

**Vulkan Memory Allocator (AMD/Community):** VMA abstracts Vulkan memory heaps and types into a simple allocate/free API with defragmentation, budget tracking, and memory mapping. VMA's `VmaBudget` per heap maps to Tribunus' arena budget per memory class (unified, device-local, host-pinned).

**MIOpen / oneDNN memory planning:** These libraries pre-plan all workspace memory before execution. MIOpen's `miopenConvolutionForwardGetWorkSpaceSize` queries required scratch memory, and users allocate once. The entire execution uses pre-allocated memory — no dynamic allocations during inference. This is exactly Tribunus' doctrine.

**IOSurface (Apple):** IOSurface is the canonical zero-copy shared memory primitive on Apple Silicon. MLX, Core ML, Metal, and Accelerate can all map the same IOSurface-backed buffers. ADR 0021 establishes IOSurface as the single authority-visible memory island for Apple Silicon v1. Every phase boundary commits back to the island. Every copy, sync, and layout conversion is receipted.

### Tribunus current state

ADR 0021 defines the IOSurface Single-Island Runtime: one memory island, IOSurface-backed, with MLX/Core ML/Accelerate as execution engines receiving temporary views. ADR 0035 defines the residency contract with MANDATORY/HOT/WARM/COLD tiers, page sizes, prefetch engine, eviction engine, and page table structure (64 bytes per entry). The `golden-machine.v1.json` schema includes `island_region`, `memory_view`, `ring_buffer`, and `kv_cache_state` definitions.

The SharedMemoryIsland is on by default. Arena::new currently supports only Float16 — a known gap where some dispatch paths silently fall back when Float32 output arenas are requested.

### Key design decisions for Tribunus

- **All memory is pre-planned at compile time.** The arena manifest specifies exact page counts, buffer sizes, and lease schedules. Runtime allocates once from the manifest — never probes or extends.
- **Lease transitions are a state machine.** A page moves through states: free → claimed → leased_read → leased_write → committed → released → free. Violations (double-lease, use-after-free, stale handle) are compile-time errors or runtime receipt violations.
- **The ring buffer is backend-private scratch, not durable truth.** Accelerate may stage through a private CPU ring buffer for alignment repair, tiling, or kernel-friendly packing, but all canonical outputs must commit to the IOSurface island before phase completion.
- **KV cache pages use PagedAttention-style block tables.** Logical KV positions map to physical pages. Copy-on-write semantics make speculative branch fork/rollback zero-copy.

---

## Pipeline 6: Fusion and Region Formation

### What it does

Creates fused backend regions by grouping adjacent canonical phases around data residency and backend strengths. The unit of optimization is the region (a subgraph of phases), not the individual operation. For example: LayerNorm + QKV projection + RoPE might fuse into one MLX Metal kernel; attention softmax + value aggregation + output projection might fuse into one Core ML MIL island; MLP gate projection + SiLU activation + elementwise multiply might fuse into one Accelerate recipe. Fused regions reduce intermediate allocation, eliminate boundary copies, and amortize backend dispatch overhead.

### Citations and existing compiler precedents

**TASO (MIT, Jia et al., SOSP 2019):** TASO is a tensor graph superoptimizer that applies verified graph substitutions to reduce computation. Given an input graph, TASO enumerates equivalent but cheaper graphs using a set of correctness-verified rewrite rules. Each substitution is verified by an SMT solver against the original semantics. TASO demonstrates that graph-level optimization (not kernel-level) can find significant speedups that individual op optimizations miss. Tribunus' region formation is TASO-style graph optimization applied to canonical phases, with fused regions as the output.

**Rammer (Microsoft, Ma et al., OSDI 2020):** Rammer schedules DNN operators on massively parallel hardware by breaking the GPU execution model into two levels: an inter-operator scheduler that manages global dataflow, and intra-operator "rFoci" (reusable function unit clusters) that execute within-wave parallelism. Rammer's insight that intra-operator parallelism should be planned alongside inter-operator scheduling maps directly to Tribunus: a region is both a fusion decision (which ops go together) and a scheduling decision (which backend runs the region).

**TensorIR Schedule Fusion (Apache TVM):** TVM's TensorIR allows schedule-level fusion through `compute_at` and `reverse_compute_at` primitives. A consumer can "compute at" a specific loop level of a producer, fusing producer and consumer loops. This is kernel-level fusion (within a single GPU kernel), whereas Tribunus needs both kernel-level fusion (within MLX Metal) and graph-level fusion (Core ML MIL islands spanning multiple ops).

**XLA Fusion (Google):** XLA's HLO fusion pass groups compatible operations into fusion nodes. Heuristics decide fusion boundaries: instruction count, memory bandwidth limits, parallelism opportunity. XLA generates custom CUDA/CPU kernels for fused operations. Tribunus needs the same decision logic applied to a different set of backends (MLX, Core ML, Accelerate).

**Core ML MIL (Apple):** Core ML's Model Intermediate Language (MIL) is the graph representation that `coremltools` lowers to ANE/GPU/CPU. A MIL program (`.mlpackage`) is a self-contained computation graph that can be compiled to ANE or GPU. Tribunus generates MIL programs for fused regions, not individual ops, to amortize Core ML boundary costs (~100-500 us per submission).

### Tribunus current state

ADR 0034 explicitly states: Core ML is a "compiled region backend, not an operation backend." The compiler should create "stable-shape MIL islands or mlpackages large enough to amortize boundary and fence costs." The architecture document envisions "fused regions around data residency and backend strengths" but does not yet define a concrete fusion algorithm or region formation pass specification.

### Key design decisions for Tribunus

- **Fusion boundaries are backend-aware.** MLX Metal can fuse smaller regions (kernel fusion within a single dispatch) while Core ML needs larger regions (amortize ~100 us boundary cost). Accelerate can chain vDSP calls across region boundaries without overhead.
- **Residency determines fusion.** If two phases operate on the same residency pages, fusing them eliminates the commit-fence-read cycle between phases.
- **Speculative decode creates fusion opportunities.** Draft proposal + candidate assembly + tree verification is a natural three-subregion fused region (ANE proposal → CPU assembly → GPU verification) as described in ADR 0034's "Expert Proposal Fabric."
- **The region manifest is part of the compute image.** Each region carries: region_id, phase list, backend_target, input_page_ids, output_page_ids, scratch_page_ids, kernel_hash, latency_budget, fallback_region_id.

---

## Pipeline 7: Speculative Execution Planning

### What it does

Defines the speculative execution strategy for the compiled model. Specifies: proposal sources (draft submodel, Medusa heads, early-exit self-speculation, or ANE-conditioned branch proposer), proposal width (how many candidate tokens per step), branch tree depth and structure (top-B candidates at each node, pruning strategy), verifier window size, acceptance policy (strict verification: longest accepted prefix; or relaxed: tokens accepted if softmax probability above threshold), rollback policy (commit accepted KV pages, roll back rejected provisional pages, recycle their arena slots), and draft/target KV page isolation.

### Citations and existing compiler precedents

**SpecInfer (UC Berkeley / Microsoft, Miao et al., 2023):** SpecInfer introduces tree-based speculative decoding: generate a candidate token tree (using multiple small draft models), pack candidates into a single input batch with a tree attention mask, run the target model once to score all candidates simultaneously, and commit the longest accepted path. SpecInfer achieves 1.5-2.8x speedup. The tree attention mask is the key mechanism: it encodes which tokens attend to which ancestors, allowing the verifier to score the entire tree in one forward pass.

**EAGLE / EAGLE-2 (Peking University, Li et al., 2024):** EAGLE uses an autoregressive draft model that operates on target model hidden states (feature-level, not token-level). EAGLE-2 extends this to tree-structured draft proposals. Acceptance rates reach 75-85% (much higher than standard speculative decoding's 60-70%). EAGLE-2's key insight: using target hidden states as draft input gives the draft model information about the target's internal representation, dramatically improving proposal quality.

**Medusa (Zhejiang University, Cai et al., 2024):** Medusa adds multiple draft "heads" (one per future position) on top of the target model's final hidden state. Each head predicts one future token. Since the heads share the target's backbone, Medusa adds negligible parameter overhead (~0.1% per head) and no separate model. Acceptance rate is lower than EAGLE (60-70%) but deployment is trivial — no separate draft model to manage.

**TensorRT-LLM Speculative Decoding (NVIDIA):** TensorRT-LLM integrates draft model execution (either a separate small model or Medusa heads) with target model execution using in-flight batching. The runtime manages draft/target KV cache isolation and acceptance verification. This is a runtime-focused approach, whereas Tribunus plans the speculative strategy at compile time.

**vLLM Speculative Decoding (UC Berkeley):** vLLM supports both draft-model-based and n-gram-based speculative decoding. The block manager handles provisional KV blocks: accepted blocks are promoted to committed, rejected blocks are freed. The key mechanism is CoW block tables: when a speculative branch forks, it gets a copy of the block table that shares committed blocks but has its own provisional blocks.

### Tribunus current state

ADR 0034's "Expert Proposal Fabric" defines a three-subregion fused region for MoE speculation: ANE proposal projection (LayerNorm + linear heads for 8 experts), CPU candidate assembly (top-k/p selection, tree metadata), and MLX GPU tree verification (packed candidate window with tree attention mask). The speculative execution contract (reserve provisional pages → draft → verify → commit accepted + discard rejected + increment generations) is defined. Research agent `ResearchSpecDecode` produced detailed findings on tree structures, acceptance rates, and backend-specific draft/verify splits.

The "KV Transaction Model" section of ADR 0034 specifies: PagedAttention-style CoW block tables, page generation counters to prevent stale handles, and a rollback policy where rejected speculative pages never contaminate authoritative KV.

### Key design decisions for Tribunus

- **The speculative plan is a compile-time decision.** Draft model topology, proposal width, tree depth, verifier window, and acceptance thresholds are frozen in the compute image. Runtime selects the tree topology but does not discover the speculative strategy.
- **Draft model shares infrastructure with target.** The compiler generates a draft submodel programmatically from the target model, sharing tokenizer, vocabulary projection shape, RoPE convention, KV layout, and quantization metadata. This improves acceptance rates over unrelated draft models (ADR 0034).
- **MoE gets ANE-conditioned speculative heads.** For MoE models, the ANE runs 8 tiny expert-conditioned linear heads predicting expert routing (ADR 0034 "Expert Proposal Fabric"), simultaneously solving expert-prefetch (what to page in) and token proposal (what to predict).
- **Tree verification is a single GPU pass.** All candidate branches are packed into one forward pass with tree-structured attention masks (SpecInfer pattern). The verifier scores the entire window and commits the longest accepted path.

---

## Pipeline 8: Sparse Attention and Long-Context Planning

### What it does

Defines the attention policy for long-context inference. Configures: attention block sparsity patterns (which KV entries to compute attention over), compression tiers (near-lossless FP8 recent tokens, compressed INT4 mid-context, summarized 2-3 bit distant context), recency window size (how many tokens get full attention), sparse attention pattern (sliding window, global-local, dilated), and per-layer KV cache bit allocation (attention layers get more bits, early layers get more bits per AsymKV findings).

### Citations and existing compiler precedents

**FlashAttention (Dao et al., 2022-2025):** FlashAttention-3 (Hopper GPUs) achieves 1.5-2.0 PFLOP/s on H100 via producer-consumer asynchrony and warp-specialization. The key algorithmic insight (tiling attention to avoid materializing the full NxN attention matrix) applies to all hardware. FlashAttention's forward pass planning (tile size, block scheduling) is what Tribunus should generate for each sequence length class.

**H2O — Heavy Hitter Oracle (Zhang et al., NeurIPS 2023):** H2O identifies "heavy hitter" KV entries (tokens whose attention scores accumulate to a large total across heads) and evicts the rest. The heavy hitter score is the cumulative attention received by each token position, updated incrementally during decoding. H2O achieves 5-10x KV cache reduction with minimal quality loss. The heavy hitter classifier is a small, deterministic computation — no learned model needed.

**StreamingLLM (Xiao et al., 2023):** StreamingLLM shows that keeping initial "attention sink" tokens (first 4 tokens) + recent sliding window tokens preserves quality, while middle tokens can be dropped entirely. This enables infinite-length generation with bounded memory. The mechanism exploits that early tokens act as attention "sinks" (they receive disproportionately high attention scores due to the softmax normalization).

**SnapKV (Li et al., 2024):** SnapKV selects important KV entries by computing an "observation window" attention pattern (attend recent queries to full past KV), aggregating importance scores per token position, and retaining the top-K entries. SnapKV achieves 3-5x compression at 128K context with <0.2 perplexity increase.

**Quest (Tang et al., 2024):** Quest uses per-head "query-aware" selection: rather than selecting the same KV entries for all attention heads, each head selects its own top-K entries based on the current query. This is more expensive (per-head selection per token) but more precise. Quest achieves 2-4x compression with better quality than uniform selection.

**InfLLM (Xiao et al., 2024):** InfLLM splits the KV cache into blocks and uses a coarse-to-fine retrieval: (1) select top-K blocks using representative keys, (2) compute full attention within selected blocks. This two-level approach is cache-friendly (blocks are contiguous in memory) and achieves 4-8x compression for 1M-token contexts.

**KV cache quantization methods:** See Pipeline 9 research agent `ResearchKVCache`. Key findings: TurboQuant uses random rotation + scalar quantization + QJL residual for 3.5 bits with <0.1 perplexity loss. KIVI uses per-channel key quantization + per-token value quantization for 3.2 bits. KVQuant uses sensitivity-weighted non-uniform quantization for 2-3 bits on cached keys. Per-layer bit allocation: early layers are more sensitive (AsymKV), attention layers need 1.5-2x more bits than FFN layers.

### Tribunus current state

ADR 0035 Section 8.3 describes the KV cache compression policy: Tier 0 (hot recent, FP8), Tier 1 (compressed mid-context, INT4 via TurboQuant/KIVI), Tier 2 (summarized distant, 2-3 bit via KVQuant). Per-layer bit allocation based on sensitivity analysis during assessment. ADR 0034 mentions sparse attention and long-context planning as a compile-time concern. The pipeline-stages.md defines attention_mask_construction (stage 21), attention_score (22), attention_softmax (23), and attention_value (24) as canonical phases. KV cache stages include kv_candidate_append (19) and kv_commit (20).

Research agent `ResearchKVCache` produced detailed findings on H2O, StreamingLLM, SnapKV, Quest, InfLLM, SparQ, and tiered storage. Research agent `ResearchSparseAttention` (ANE sparse attention routing researcher) and `ResearchKVCompression` (ANE KV compression researcher) are still running.

### Key design decisions for Tribunus

- **Attention policy is per-model, per-sequence-length-class.** A 32K context model gets a different attention sparsity plan than a 1M context model. The compiler profiles attention quality at multiple sequence length thresholds and emits a tiered policy.
- **H2O-style heavy hitter tracking as a canonical phase.** The KV cache append phase tags each entry with cumulative attention score. The eviction policy uses this to select which entries to compress or drop.
- **Block-sparse attention for compute-bound prefill.** For prefill (where attention is O(N^2) compute-bound rather than memory-bandwidth-bound), block-sparse patterns reduce compute. FlashAttention-style tiling parameters are compiled per sequence length class.
- **Per-layer KV bit allocation is a knapsack problem.** Similar to weight codec assignment (pipeline 1), the compiler solves: maximize attention quality given KV cache memory budget, assigning bitwidths per layer and per tier.

---

## Pipeline 9: Model Virtual Memory

### What it does

Splits weight tensors into self-describing pages (64 KB dense, 256 KB expert FFN). Assigns each page a residency tier (MANDATORY, HOT, WARM, COLD). Defines the prefetch engine strategy (sequential for dense layers, router-predicted for MoE experts, temporal-reuse for frequently accessed pages). Defines the eviction policy (LRU + compiler hints: sticky, disposable, speculative). Defines the page fault handler (stall lane, async disk load, decompress if needed, update page table, resume). For MoE: integrates the ANE expert residency predictor (Fate-inspired cross-layer gate prediction at 97.15% accuracy, 99.08% cache hit rate). Emits a residency manifest — the page table configuration for the entire model.

### Citations and existing compiler precedents

This pipeline is extensively designed in ADR 0035 and researched by the `ResearchModelVM` subagent. The full design is in `docs/adr/0035-model-virtual-memory-weight-codec.md`. Key external references:

**FlexGen (Sheng et al., 2023):** FlexGen offloads weights, activations, and KV cache to CPU RAM, SSD, and GPU VRAM in a three-tier hierarchy. It solves a linear programming problem to determine optimal placement given bandwidth constraints. FlexGen uses 4-bit quantization for offloaded weights and achieves 1-3 token/s for 175B models on a single GPU. The key lesson: the memory planning problem is a constrained optimization (linear programming or knapsack), and Tribunus should solve it at compile time.

**vLLM PagedAttention:** While vLLM focuses on KV cache paging, the block-table-based virtualization is the same pattern Tribunus applies to weight pages. The page table maps logical page IDs to physical locations (in unified memory or on disk), with residency status, generation counter, and predicted-next-use timestamp.

**Fate (UC Berkeley / UCSD, Feb 2025):** Fate demonstrates that cross-layer gate signals predict next-layer expert selection with 97.15% accuracy using a simple predictor. Fate's "shallow-favoring" caching strategy (keep more experts resident in early layers) directly informs Tribunus' per-layer residency budget. The ANE expert residency predictor (research/docs/ane-expert-residency-prediction.md) builds on Fate with additional features: domain classification, attention entropy, branch structure, achieving 99%+ cache hit rates.

**Oracle-MoE (2024) / ADEPT (April 2026):** Both use semantic domain signals to prefetch experts. ADEPT classifies the prompt domain during prefill and preloads domain-relevant experts. Tribunus can adopt this for the prefill phase (bulk prefetch based on prompt classification) supplemented by incremental prediction during decode.

### Tribunus current state

ADR 0035 is the complete design: WeightCodec interface, residency tiers, page table (64 bytes per entry), page fault handling, prefetch engine (sequential + router-predicted + temporal-reuse), eviction engine (LRU + compiler hints), and paging receipts. Estimated effort: 15-17 weeks total. The page table entry already includes `predicted_next_use` — the integration point for the ANE predictor.

### Key design decisions for Tribunus

- **Page fault handling is lane-stalling, not async with other work.** When a lane needs a non-resident page, it stalls. The disk read + decompression happens while the GPU is idle for that lane. This is simpler than work-stealing and acceptable because the prefetch engine should make page faults rare (<3% miss rate).
- **MANDATORY page faults are fatal.** If a page tagged MANDATORY is not resident, this is a compilation bug — the residency contract was violated.
- **Unified memory eliminates the double-copy problem.** On Apple Silicon, NVMe reads land directly in unified memory (no CPU→GPU copy). Expert paging from NVMe is viable at ~6 GB/s with 22-layer prefetch depth.
- **The prefetch engine is compiler-guided, not purely learned.** The compiler emits explicit prefetch hints (sequential for dense layers, stride patterns for expert blocks), supplemented by the ANE predictor for dynamic routing decisions.

---

## Pipeline 10: Receipt and Conformance Generation

### What it does

Emits expected receipts for every region, phase, and page lifecycle event in the compute image. Each receipt is a structured record (JSON) that the runtime fills and compares against expected values. Fields include: backend identity, native symbols called, bytes copied (H2D, D2H, D2D), arena allocation success/failure, fused region integrity (did the region execute as compiled or decompose into fallback ops?), fallback count per priority level, stage durations (scheduler, backend, fence, copy), page lifecycle events (lease, read, write, release, recycle, fault, evict), speculative branch acceptance/rejection, disk bytes read, page fault rate, and expert prefetch hit rate. The runtime compares expected receipts (from the compute image) to actual receipts (from execution) and flags violations.

### Citations and existing compiler precedents

**Formal Verification Contracts (Verifiable C, Frama-C, Dafny):** These systems embed preconditions, postconditions, and invariants into the source code. The verifier proves (statically) or checks (dynamically) that the program satisfies its contract. Tribunus' receipt model is simpler: the "contract" is the compute image's expected execution behavior, and the "verification" is runtime comparison of expected vs actual receipts. This is closer to runtime assertion checking than full formal verification — but applied at the compiler/architecture level rather than the source code level.

**IEEE P2415 — Performance Contracts (IEEE Standards Association):** IEEE P2415 is a proposed standard for "Unified Hardware Abstraction and Layer for Energy Proportional Computing." It defines performance contracts between software and hardware: the software declares expected resource usage, the hardware guarantees performance bounds, and both sides report conformance. This is the closest existing standard to Tribunus' receipt model — a bidirectional contract between the compiler (what should happen) and the runtime (what actually happened).

**CUDA Profiler Counters (NVIDIA):** `cuptiActivityGetAttribute` and the CUDA Profiling Tools Interface (CUPTI) provide detailed GPU event counters: kernel execution time, memory transfer bytes, cache hit rates, DRAM utilization. NVIDIA Nsight Systems and Nsight Compute consume these counters to produce execution timelines. Tribunus receipts are the compile-time specification of which counters matter, plus the runtime validation that they match expected values.

**TensorBoard Profiler (Google):** The TensorFlow profiler captures a trace of every operation, including op name, device, duration, tensor shapes, and memory usage. TensorBoard visualizes this as a timeline. Tribunus extends this model from post-hoc profiling to online conformance checking: every receipt generates a live comparison, not just a trace.

**rocket-chip / RISC-V performance counters:** RISC-V defines a set of hardware performance counters (`mcycle`, `minstret`, cache miss counters) accessible via CSR instructions. The counters are defined by the ISA; software reads and compares them. Tribunus receipts are the architectural equivalent: the "ISA" is the compute image, and the "counters" are the receipt fields.

### Tribunus current state

ADR 0034 Layer 3 (Receipts) defines the receipt specification: per-token receipts with backend identity, native symbols, byte counts, arena allocations, fallback counts, stage durations, page lifecycle events, disk bytes, speculative branch acceptance, and KV page lifecycle. The `golden-machine.v1.json` schema includes `audit_event`, `audit_chain`, `golden_violation`, and `violation_code` definitions representing an immutable hash-chained audit log. ADR 0034 estimates 1 week for receipt infrastructure.

The `backend-capability.v1.json` schema requires that backends declare their observability level (structured, opaque, or none). Backends with `none` observability must be wrapped in an instrumented shim.

### Key design decisions for Tribunus

- **Receipts are a compile-time spec, runtime validation.** The compiler emits expected receipt templates per region (e.g., "attention_score region on MLX Metal should produce: backend=mlx_metal, bytes_copied=0, fallback_count=0, latency_avg_us < 50"). The runtime fills actual values and flags mismatches.
- **Receipt vocabulary is finite and stable.** Receipt field names and types are governed by the schema system (`schemas/`). New fields are added via schema evolution; existing fields never change semantics.
- **Receipt violation does not stop inference.** A violation is recorded in the audit log but the runtime continues. Policy decisions (alert, throttle, fallback, degrade) are separate from receipt collection.
- **Hash-chained audit log prevents tampering.** Each audit event includes the hash of the previous event, creating an append-only chain. Any attempt to modify a past receipt breaks the chain — detectable by any consumer.

---

## Recommended Implementation Order

### Phase 0: Cross-cutting Infrastructure (Weeks 1-2)

**Pipeline 10 (Receipts + Conformance) — start immediately.** Receipt infrastructure is not a post-hoc bolt-on; every other pipeline emits receipt templates. Implement: receipt schema, audit log with hash-chaining, receipt template generation pass, runtime receipt comparison engine. Without receipts, pipeline 1-9 cannot prove they work.

**Pipeline 2 (Shape + Topology Assessment) — start immediately.** The machine profile is consumed by every downstream pass. Implement: sysctl-based hardware detection for Apple Silicon, benchmark harness for microbenchmarks (matmul, attention, softmax at key shape points), machine_profile schema population, BackendCapability certificate registration.

### Phase 1: The Core Compiler (Weeks 3-6)

**Pipeline 1 (Weight Ingestion + Compression) — first full pass.** Dependencies: Pipeline 10 (receipt templates), Pipeline 2 (machine profile for codec selection). Deliverable: safetensors ingestion, architecture inference, GroupQuantized codec (INT4/INT8, AWQ scaling), knapsack solver for per-layer codec assignment, weight page packing with self-describing headers, fused dequantize-matmul kernel handles for MLX Metal.

**Pipeline 3 (Canonical Phase Lowering) — in parallel with Pipeline 1.** Dependencies: Pipeline 2 (shapes and dtypes). Deliverable: lowering pass for LLaMA-family architectures into the 42 canonical phases (pipeline-stages.md), phase graph construction with shape/dtype resolution, phase contract enforcement (declared inputs/outputs per phase). MoE phases deferred to Phase 3.

### Phase 2: Execution Planning (Weeks 7-10)

**Pipeline 5 (Arena Planning) — first.** Dependencies: Pipeline 3 (phase graph defines producer-consumer edges), Pipeline 2 (memory bandwidth determines ring buffer sizing). Deliverable: IOSurface-backed island allocation plan, page class determination, lease schedule generation, KV cache budget allocation, scratch budget allocation, arena manifest emission.

**Pipeline 4 (Backend Candidate Generation) — in parallel with Pipeline 5.** Dependencies: Pipeline 3 (phases to generate candidates for), Pipeline 2 (target capabilities constrain candidates). Deliverable: MLX Metal candidate generator, Accelerate recipe generator, Core ML MIL island compiler prototype, Rust scalar fallback for all phases, candidate benchmarking harness, dispatch table with fallback chains.

**Pipeline 6 (Fusion + Region Formation) — after Pipelines 4 and 5.** Dependencies: Pipeline 4 (candidates must exist to fuse), Pipeline 5 (residency determines fusion opportunities). Deliverable: fusion heuristic engine (boundary cost model + residency graph), region formation pass, per-region compilation (Metal kernel, Core ML MIL, Accelerate recipe), region manifest emission.

### Phase 3: Advanced Features (Weeks 11-16)

**Pipeline 9 (Model Virtual Memory) — first among advanced features.** Dependencies: Pipeline 1 (weight pages exist), Pipeline 5 (arena manifest defines memory budget). Already designed in ADR 0035. Deliverable: page table implementation, page fault handler, sequential prefetch engine, LRU + compiler-hint eviction engine, MANDATORY/HOT/WARM/COLD tier enforcement, paging receipts.

**Pipeline 7 (Speculative Execution Planning) — after Pipeline 6.** Dependencies: Pipeline 6 (fused regions for draft/verify split), Pipeline 4 (candidate generation for draft model), Pipeline 5 (provisional page budget). Deliverable: draft submodel topology planning, tree attention mask generation, acceptance policy configuration, KV transaction model implementation, speculative plan emission.

**Pipeline 8 (Sparse Attention + Long-Context Planning) — after Pipeline 3.** Dependencies: Pipeline 3 (phase graph for attention phases), Pipeline 2 (memory bandwidth determines compression aggressiveness). Deliverable: H2O heavy hitter tracking phase, per-layer KV bit allocation planner, tier migration policy engine, block-sparse attention plan for prefill, streaming window configuration.

### Phase 4: MoE and Large Models (Weeks 17-22)

**Pipeline 1 extension — MoE weight ingestion.** Per-expert codec assignment, routed expert page packing with expert_id annotation, shared expert + router mandatory residency tagging.

**Pipeline 3 extension — MoE phase lowering.** Route phase, expert gate dispatch, expert execute, expert combine as canonical phases.

**Pipeline 9 extension — MoE model virtual memory.** Router-predicted prefetch engine (Fate-based, ANE predictor integration), per-expert page table entries, expert switching cost model, ADEPT-style domain-based bulk prefetch for prefill.

**Pipeline 7 extension — MoE speculation.** Expert Proposal Fabric (ANE-conditioned speculative heads), expert prefetch + token proposal co-optimization.

### Phase 5: Multi-Backend Portability (Weeks 23+)

**Pipeline 4 extension — additional backend generators.** AMD ROCm/HIP candidate generator via CubeCL, Intel oneAPI candidate generator, NVIDIA CUDA candidate generator, Tenstorrent TT-Metalium candidate generator, Vulkan candidate generator (WebGPU/Android).

**Pipeline 2 extension — non-Apple hardware assessment.** Linux sysfs-based hardware detection for AMD/Intel/NVIDIA GPUs, ROCm-smi / NVML topology discovery, Windows DXGI adapter enumeration.

**Pipeline 1 extension — portable compression formats.** GGUF compatibility, Marlin kernel integration (NVIDIA), ROCm-aware AWQ kernels, SYCL port for Intel GPUs.

---

## Dependency Graph Summary

```
Phase 0 (parallel):   P10 (Receipts)  +  P2 (Assessment)
                            |                  |
Phase 1 (parallel):   P1 (Weights)     P3 (Lowering)
                            |                  |
Phase 2 (sequence):   P5 (Arena)  →  P4 (Candidates)  →  P6 (Fusion)
                            |              |                  |
Phase 3 (parallel):   P9 (Model VM)   P7 (Speculation)   P8 (Sparse Attn)
                            |
Phase 4 (extension):   MoE in P1/P3/P9/P7
                            |
Phase 5 (extension):   Multi-backend in P2/P4/P1
```

Cross-cutting concern: Pipeline 10 (Receipts) generates templates for every other pipeline's output. It must be the first pipeline implemented and the last pipeline to mature — receipts for all features.

---

## Risk Assessment

| Pipeline | Risk | Mitigation |
|----------|------|------------|
| P1 (Weights) | INT4 kernel quality varies by backend | Ship GroupQuantized first; defer RotationQuantized and CodebookQuantized |
| P2 (Assessment) | Hardware changes invalidate cached profiles | Assessment is fast (<5 min per model); re-run on OS/driver updates |
| P3 (Lowering) | New model architectures don't map to existing phases | Phase set is extensible via additive versioning; existing phases are immutable |
| P4 (Candidates) | CubeCL alpha stability | Direct Metal shader fallback for critical kernels; CubeCL for non-critical |
| P5 (Arena) | Arena::new Float32 gap causes silent fallback | Fix early; comprehensive dtype testing for all page classes |
| P6 (Fusion) | Fusion boundary heuristics are model-specific | Start with conservative boundaries; relax based on benchmark data |
| P7 (Speculation) | Acceptance rate below viability threshold | Gate on pre-ship benchmarks; disable speculation for models where speedup < 1.2x |
| P8 (Sparse Attn) | Quality degradation at extreme context lengths | Per-sequence-length-class profiling; fallback to dense attention below quality threshold |
| P9 (Model VM) | Page fault rate spikes under domain shift | ANE predictor + ADEPT domain classification; page table over-provisioning for volatile domains |
| P10 (Receipts) | Receipt overhead slows inference | Receipts are amortized per token, not per op; JSON serialization is small per event (~200 bytes) |

---

## References

1. ADR 0034: Compiled Backend Inference Architecture — docs/adr/0034-compiled-backend-inference-architecture.md
2. ADR 0035: Model Virtual Memory and Weight Codec Architecture — docs/adr/0035-model-virtual-memory-weight-codec.md
3. ADR 0035 Research: Weight Quantization Codec — docs/adr/0035-weight-quantization-codec-research.md
4. ADR 0021: IOSurface Single-Island Runtime — docs/adr/0021-iosurface-single-island-runtime-memory-foundation.md
5. ADR 0019: Tribunus Compute Kernel — docs/adr/0019-compute-kernel.md
6. ADR 0033: Discrete GPU Compute Islands — docs/adr/0033-discrete-gpu-compute-islands.md
7. Pipeline Stages Taxonomy — research/docs/pipeline-stages.md
8. Optimization Taxonomy — research/docs/optimization-taxonomy.md
9. Research Methodology — research/docs/methodology.md
10. ANE Expert Residency Prediction — docs/research/ane-expert-residency-prediction.md
11. ANE Weight Decompression Policy — docs/research/ane-weight-decompression-policy-research.md
12. Compute Architecture Canonical Summary — docs/compute-architecture-canonical-summary.md
13. Speculative Decoding Research — agent://ResearchSpecDecode
14. Model Virtual Memory Research — agent://ResearchModelVM
15. KV Cache Compression Research — agent://ResearchKVCache
16. Chen et al., "TVM: An Automated End-to-End Optimizing Compiler for Deep Learning," OSDI 2018
17. Lattner et al., "MLIR: Scaling Compiler Infrastructure for Domain Specific Computation," CGO 2021
18. Vanholder, "Efficient Inference with TensorRT," NVIDIA GTC 2019
19. Jia et al., "TASO: Optimizing Deep Learning Computation with Automatic Generation of Graph Substitutions," SOSP 2019
20. Ma et al., "Rammer: Enabling Holistic Deep Learning Compiler Optimizations with rTasks," OSDI 2020
21. Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention," SOSP 2023
22. Miao et al., "SpecInfer: Accelerating Generative Large Language Model Serving with Tree-based Speculative Inference and Verification," 2023
23. Li et al., "EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty," ICML 2024
24. Dao et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness," NeurIPS 2022
25. Zhang et al., "H2O: Heavy-Hitter Oracle for Efficient Generative Inference of Large Language Models," NeurIPS 2023
26. Sheng et al., "FlexGen: High-Throughput Generative Inference of Large Language Models with a Single GPU," ICML 2023
27. Fate, "Accurate Expert Predictions in MoE Inference via Cross-Layer Gate," Feb 2025
28. IEEE P2415, "Unified Hardware Abstraction and Layer for Energy Proportional Computing," draft standard
