# ADR 0034: Compiled Backend Inference Architecture — Assessment, Compilation, Execution, and Receipts

## Status
Proposed — June 2026 (updated June 2026)

## Context

The preceding ADRs (0029-0033) define backends for specific hardware platforms, but they assume backend selection can happen at runtime via dispatch tables. Experience building the Apple Silicon inference engine revealed a deeper architecture: optimal backend selection is a compilation problem, not a dispatch problem. The runtime must not be discovering graphs, lazily compiling kernels, allocating surprise temporaries, or choosing backends during inference. Every decision must be made during compute-image compilation and frozen into a placement manifest. This ADR formalizes the four-layer compiled inference model that all platform-specific ADRs implement.

## Principle: Backend Optimality Must Be Compiled, Not Improvised

A runtime that discovers graphs, chooses kernels, allocates memory, and selects backends during inference is a general-purpose framework — the opposite of what Tribunus aims to be. The compiler knows the model, shapes, phase schedule, placement, memory layout, and golden path before the first token is generated. Every runtime decision that can be made at compile time must be made at compile time. The compute image freezes the winners.

## Architecture Layers

### Layer 0: Assessment

Assessment measures real backend behavior on the current machine topology during compilation, never during inference. Backend candidates compete: the compiler defines the phase, inputs, outputs, layout, dtype, residency, latency budget, tolerance, and legal fallbacks. Each candidate runs benchmarks. The winners are frozen into the compute image.

Assessment records which backend wins for each model family, shape class, sequence length, dtype, layout, and token phase.

### Layer 1: Compilation

Emits a machine-specific compute image containing:

- **Placement manifest:** Which phases run on which backend; fallback chains in priority order
- **Prequalified kernels:** Precompiled Metal/ROCm/CUDA/RISC-V kernels, benchmarked and validated on this device, frozen into the image
- **Memory layout:** Page leases, arena sizes, residency contracts — every buffer known before execution
- **Speculative plan:** Draft model topology, candidate tree structure, verifier window size, acceptance thresholds. The compiler generates both linear and tree speculation paths. Tree topology is a runtime decision. Supports EAGLE-style feature-level draft models (up to 85% acceptance), Medusa-style multiple draft heads (zero-footprint draft), and self-speculation via early exit.
- **Receipt specification:** Which events must be recorded, what byte counts tracked

**Weight Compression Pipeline:** Compilation includes a weight encoding pass that assigns per-layer codecs. AWQ 4-bit for primary layers, codebook quantization for cold MoE experts, INT8 for sensitive layers. The compressed weight image carries a decode contract: block size, scale layout, zero-point layout, group size, codebook identity, outlier table, checksum, backend kernel handle, and legal decompression targets. The WeightCodec interface exposes encode (compile time), decode (fallback), and execute (fused dequantize-matmul, the default).

**KV Cache Compression Policy:** Multi-tier KV: hot recent tokens in FP8 (near-lossless), compressed mid-context in INT4 via TurboQuant/KIVI (3.5 bits, <0.1 perplexity loss), summarized distant context at 2-3 bits via KVQuant. Per-layer bit allocation based on sensitivity analysis during assessment.

Also generates model-agnostic canonical phases: multi-token prediction, sparse attention, paged KV operations, KV compression, speculative branch commit/rollback, token-tree verification, block allocator checks.

### Layer 2: Execution

A deterministic state machine over precompiled backend lanes and memory-page leases. The runtime is "lease page, submit known backend region, fence, advance state" — not "run dynamic tensor program."

**Model Virtual Memory:** Weight pages are paged executable memory with residency contracts. MANDATORY pages (embeddings, norms, router, output head) are always resident. HOT pages (dense attention, frequent experts) live in the arena with prefetch. WARM pages (cold experts) are disk-backed. Page fault handling stalls the lane, issues async disk load, decompresses if needed (fused execution avoids decompression), updates the page table, and resumes. Prefetch engine uses sequential (dense layers), router-predicted (MoE — Fate-inspired cross-layer gate prediction at 97.15% accuracy), and temporal-reuse strategies. Eviction uses LRU + compiler hints (sticky, disposable, speculatively-loaded classes). The page table entries are 64 bytes each (~333 MB for 5.2M pages at 64 KB).

- No graph discovery during inference
- No lazy kernel compilation
- No surprise memory allocation
- Fallback is defined in the manifest, not improvised
- Orchestration overhead: arena handoff + fence latency (~30-80 ns per region)

### Layer 3: Receipts

Every inference step produces receipts. Without receipts, the runtime cannot distinguish "the golden path executed" from "correct output happened through fallback."

Per-token receipts include:
- Which backend actually executed
- What native symbols were called
- Bytes copied (H2D, D2H, D2D)
- Arena allocation success/failure
- Fused region integrity (no fallback decomposition)
- Fallback count per priority level
- Stage durations (scheduler, backend, fence, copy)
- Page lifecycle events (lease, read, write, release, recycle, fault, evict)
- Disk bytes read, page fault rate, expert prefetch hit rate
- Speculative branch acceptance/rejection

Backends that cannot emit receipts must be wrapped in an instrumented shim.

## Backend Roles

**GPU Lane:** The GPU executes known kernels on known buffers with known threadgroup configurations — no discovery, no JIT, no surprise allocations. The tailored kernel generation capability is valuable; move it to compile time, not inference-time JIT.

**NPU Lane:** Not an operation backend — a compiled region backend. Receive fused regions large enough to amortize boundary costs, not tiny ad hoc ops.

**CPU Lane:** A fused execution recipe backend for deterministic low-latency CPU-side reductions, normalization, sampling, checksums, validation. Avoid GPU/NPU overhead where the residency contract is preserved.

## Speculative Decoding Model

### Draft Model

A speculative tiny submodel generated programmatically at compute-image compilation time based on the same model. Shares tokenizer, vocabulary projection, RoPE convention, KV layout, quantization metadata, and architecture assumptions with the target model. Dramatically improves acceptance rates over unrelated draft models.

### Tree Speculative Decoding

The NPU/CPU produces a speculative candidate tree (top-B candidate tokens at each node, 3-6 levels deep, 16-64 total nodes). The GPU verifies the entire tree in one forward pass using tree-structured attention masks (SpecInfer, EAGLE-2). The target model remains authoritative. The verifier scores a packed candidate window, commits the longest accepted path, rolls back rejected pages.

### KV Transaction Model

Draft KV pages must never contaminate authoritative target KV unless accepted. Rejected branches roll back cleanly. PagedAttention-style copy-on-write block tables make fork/rollback zero-copy. The speculative execution contract:

1. Reserve provisional pages
2. Run draft proposal on NPU/CPU
3. Run target verification on GPU
4. Commit accepted pages
5. Discard rejected pages
6. Increment generations for recycled pages

### Expert Proposal Fabric: ANE-Conditioned Speculative Heads for MoE Models

A fused heterogeneous region, not a fused kernel. A kernel implies one backend owns one execution body. This is more powerful: one logical compute-image phase split into backend-native subregions with a shared IOSurface arena contract.

**Three-subregion architecture:**

1. **ane_proposal_project** (ANE / Core ML MIL region): Fused MIL program with 8 expert-conditioned heads (LayerNorm + linear projection). ANE runs static numeric projection: receives expert outputs from IOSurface arena, executes fused MIL graph, writes proposal tensors back to arena pages. Small, static, shape-stable graph. Prefer 1x1 convolution lowering (3x faster on ANE’s convolution engine).
2. **cpu_candidate_assemble** (CPU / Rust): Reads proposal tensors from same IOSurface pages — zero-copy. Performs top-k/top-p (hard selection, not gumbel-softmax — gumbel is for training), candidate filtering, checksums, tree metadata, verification handoff. Not a fallback — part of the fused region contract.
3. **mlx_tree_verify** (GPU / MLX Metal): Authoritative verifier. Scores all candidates in one pass via tree attention. Commits longest accepted path. Rolls back rejected speculative pages.

**SRAM model:** Performance tier, not correctness boundary. Proposal fabric lives in unified memory through IOSurface-backed pages. SRAM residency is an optimization outcome. The compiler emits two expectations: SRAM-hot (preferred, full ~5.7 TFLOPS) and DRAM-resident (valid, ~4.0 TFLOPS). Assessment determines which occurs.

**Compilation path:** Train heads in PyTorch. Convert via coremltools. Compile through public Core ML pipeline, requesting ANE compute units. Core ML may place on ANE, GPU, or CPU — assessment measures actual placement. The compute image freezes measured placement, not hoped-for placement. Experimental Orion path (private API) behind feature flag.

**Delta compilation:** Patches weight-bearing MIL artifacts without full recompilation (~500ms). Weight updates for fine-tuning or model revision update weight payload without rebuilding from scratch.

**Training objective:** Maximize accepted tokens per verifier pass. Loss mixture: next-token cross entropy + target-logit distillation + acceptance-oriented loss + diversity loss across 8 heads.

**Receipt schema:**
Fields: compile_path (coreml / orion_experimental), compute_unit_request, observed_backend, proposal_graph_hash, sram_fit_estimate (hot / resident / overflow), observed_latency_profile_us, input_arena_ids, output_arena_ids, proposal_count, proposal_entropy, tree_width, candidate_selection_backend, verifier_backend, verifier_window_tokens, accepted_prefix_length, rollback_pages, host_copy_bytes, fallback_reason

## Relation to Platform ADRs

Every platform ADR (0029-0033) must implement:

1. **Receipt emission** per Layer 3 contract
2. **Separation of compile/execute** — compile() produces precompiled artifacts, execute() dispatches only precompiled artifacts
3. **Weight compression pipeline** — per-layer codec assignment, fused dequantize-matmul as default execution mode
4. **Model virtual memory** — residency contracts, page fault handling, prefetch engine
5. **KV cache compression** — multi-tier policy, per-layer bit allocation
6. **Speculative decoding support** — provisional KV pages, verifier-style batched execution, tree attention masks
7. **Assessment benchmarks** — self-describing capability and performance characteristics

## Consequences

### Positive

- Deterministic performance — no runtime JIT, no surprise allocations
- Measurable correctness — receipts distinguish golden path from fallback
- Speculation as a first-class primitive, not a post-hoc bolt-on
- Portability without sacrifice — same IR, different compute images
- Reusable canonical kernel library across all models and backends
- Weight compression as a compiler pass ensures optimal format per layer
- Model virtual memory enables models that exceed physical memory

### Negative

- Full compilation pass per model/hardware combination — adds friction during development
- Assessment must re-run on hardware or driver changes
- Receipt specification is backend-dependent — may leak vendor-specific events
- Speculative decoding increases compilation complexity significantly
- Each codec format requires fused dequant kernels per backend

### Estimated Cross-Cutting Effort

1. Receipt infrastructure: 1 week
2. Assessment framework: 3 days per backend
3. Compile/execute separation: 1 week
4. Weight compression pipeline: 2 weeks
5. KV cache compression: 1-2 weeks
6. Model virtual memory + page table: 3-4 weeks
7. Tree speculative decoding: 1-2 weeks
8. Speculative decoding phase: 2-3 weeks
9. KV transaction model: 1-2 weeks

Total: 8-13 weeks shared + 3 days per backend for assessment.
