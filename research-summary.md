# Backend-Candidate Generation Research: Patterns for a Portable Inference Compiler on Apple Silicon

## Research Summary and Recommendations for Tribunus

---

## 1. Introduction

Tribunus aims to be a portable inference compiler targeting Apple Silicon's heterogeneous compute surface: the Apple Neural Engine (ANE), the Metal GPU (via MLX or custom Metal Shading Language kernels), the CPU (via Accelerate or plain Rust), and potentially Core ML's MIL intermediate representation. The compiler's defining architectural bet is that it should pre-declare all memory, generate *multiple backend candidates per canonical phase*, benchmark them on actual hardware, and freeze winners into a deterministic compute image — with no allegiance to any particular backend except what the silicon itself reveals through measurement.

Five research areas were investigated to inform this design:

1. **Backend-candidate generation** — how existing compilers generate and evaluate multiple implementations for the same computation.
2. **Assessment-based winner freezing** — how JIT/AOT systems use online benchmarking to choose among candidates.
3. **Shape families, not one kernel** — how optimizers generate shape-specialized variants and select at runtime.
4. **Fused region binaries** — how operator fusion is done at the graph and kernel level.
5. **Receipt feedback loops** — how runtime telemetry flows back to inform recompilation.

What follows is a synthesis of findings across Apache TVM (AutoTVM, Ansor, TensorIR), Halide AutoScheduler, MLIR, TensorRT, XLA/OpenXLA, CUDA Graphs, LLVM PGO, Java HotSpot JIT, TASO, Rammer, Nimble, and the Apple-specific stack (Core ML, MPSGraph, MLX, ANE).

---

## 2. Backend-Candidate Generation

### 2.1 TVM: Ansor and AutoTVM

TVM's architecture separates the *computation* (what to compute, expressed in Tensor Expression or TensorIR) from the *schedule* (how to compute it — loop tiling, unrolling, vectorization, memory hierarchy placement, parallelization strategy). This separation is the foundational pattern: without it, you cannot generate multiple candidates because you cannot vary the "how" independently of the "what."

**AutoTVM (first generation)** requires expert-written schedule templates per operator per hardware target. These templates define a *constrained search space* of optimization choices. A machine-learning-guided optimizer (gradient-boosted trees, genetic algorithms) iteratively: samples candidates from the template space, profiles them on actual hardware, updates a learned cost model from the profiling results, and uses that model to guide the next round of sampling. This iterative profile-refine-sample loop converges to a near-optimal kernel within the template-defined space.

**Ansor (second generation)** eliminates manual templates. It automatically constructs a large search space from the tensor expression using a hierarchical representation that separates high-level structure from low-level detail. A program sampler generates diverse *sketches* (structural candidates), an evolutionary search algorithm prunes the space using a learned cost model, and a task scheduler allocates tuning time budget across subgraphs proportional to their performance impact. The critical innovation is that Ansor does not need per-operator per-hardware expertise to generate plausible candidates — it discovers them through structural exploration.

**Takeaway for Tribunus**: The TVM pattern is directly applicable. Tribunus' canonical phases (RoPE+KV write, RMSNorm+residual+quantize, attention tile prep) should each be expressed in a schedule-agnostic IR. The compiler then generates candidates by varying the schedule: Metal compute kernel vs. MLX graph vs. Core ML MIL island vs. Accelerate vDSP recipe. Ansor's automatic search space construction is the right reference point — Tribunus should not require manual per-backend templates for each new model family.

### 2.2 Halide AutoScheduler and MLIR

Halide's AutoScheduler explores a combinatorial space of loop transformations (splitting, fusing, reordering, tiling, unrolling, vectorization) and memory optimizations. When integrated with MLIR, Halide schedules map to MLIR's Transform dialect, which applies transformations to Linalg operations.

The Halide approach mirrors TVM's but emphasizes the algorithm/schedule separation more formally in the language itself. Halide also pioneered *cost-model-driven pruning*: because the search space is too large to exhaustively benchmark (potentially millions of candidates), a learned cost model rapidly estimates performance, and only the most promising candidates reach actual hardware measurement.

**Takeaway for Tribunus**: The MLIR connection is especially relevant. If Tribunus adopts an MLIR-based IR (StableHLO or a custom dialect), the Transform dialect infrastructure provides a ready-made mechanism for applying and composing schedule transformations. The cost-model-driven pruning approach is essential — Tribunus cannot afford to compile and benchmark every candidate for every model. A lightweight ML-based cost model trained on prior compilation receipts would dramatically reduce the assessment phase's wall-clock time.

### 2.3 TensorRT Builder

TensorRT's builder phase generates multiple *tactics* (kernel variants) for each layer — different convolution algorithms (GEMM, Winograd, FFT), different data layouts, different precision choices. Each tactic is profiled on the actual GPU at the specified OPT dimensions, and the fastest is baked into the serialized engine. This is the closest existing system to Tribunus' "assessment freezes winners" concept.

TensorRT also demonstrates *timing cache* persistence: profiling results are cached to disk and reused across builds, so re-optimization for the same model on the same hardware is fast.

**Takeaway for Tribunus**: TensorRT's timing cache is a critical design pattern. Tribunus should persist assessment receipts — not just the winning kernel but the full candidate benchmark results — indexed by (model hash, phase hash, shape family, backend, device). This enables incremental recompilation and informed re-evaluation when models change subtly.

### 2.4 CUDA Graph Capture

CUDA Graphs capture a sequence of kernel launches and memory operations into a single replayable graph object, eliminating per-kernel launch overhead. While this is NVIDIA-specific, the concept is general: a *region* of computation is compiled as a unit, not op-by-op. This maps directly to Tribunus' fused-region approach.

**Takeaway for Tribunus**: Metal's `MTLIndirectCommandBuffer` and `MTLComputeCommandEncoder` offer analogous capabilities. A fused region in Tribunus should compile to a single command buffer dispatch where possible, avoiding the overhead of per-op submission.

### 2.5 Apple-Specific: Core ML, MPSGraph, MLX

On Apple Silicon, the backend landscape is fragmented:

- **Core ML / ANE**: Core ML automatically offloads compatible operations to the ANE, but this is *all-or-nothing* — if any layer in a subgraph is ANE-incompatible, the entire subgraph falls back to GPU or CPU. This is a leaky abstraction that Tribunus can exploit: by explicitly targeting ANE-compatible subgraphs (CNNs, certain RNNs, depthwise separable convolutions) as one candidate backend, and falling back to Metal for transformer attention patterns that the ANE was not designed for.

- **MPSGraph**: Lower-level than Core ML, targeting GPU. Provides fine-grained control over operator fusion and memory but does not expose ANE directly through public API.

- **MLX**: Apple's newer array framework. Uses unified memory (no CPU-GPU copies), lazy evaluation, composable function transforms (autodiff, vectorization, graph optimization). Currently targets CPU and GPU; ANE support is indirect through Metal or still evolving. MLX represents the closest approximation to a "stock MLX graph" backend candidate for Tribunus.

- **Accelerate / vDSP**: Provides highly optimized CPU kernels for BLAS, FFT, and signal processing. A natural "plain Rust fallback" candidate, but Accelerate is often faster than hand-rolled Rust for dense linear algebra on Apple Silicon CPUs.

**Takeaway for Tribunus**: The candidate set per phase should be: (1) custom Metal compute kernel, (2) MLX graph (lazy-evaluated, GPU), (3) MPSGraph kernel (GPU, with operator fusion), (4) Core ML / MIL island (ANE when compatible), (5) Accelerate vDSP/BLAS recipe (CPU), (6) plain Rust fallback (CPU, no dependencies). The compiler should generate all applicable candidates and let assessment choose.

---

## 3. Assessment-Based Winner Freezing

### 3.1 JIT Compilers: Java HotSpot and V8

The Java HotSpot JVM is the canonical example of *continuous online benchmarking driving compilation decisions*. HotSpot's tiered compilation pipeline works as follows:

1. **Interpretation**: All code starts interpreted. The JVM collects profiling counters — method entry counts, branch frequencies, type information, memory access patterns.
2. **C1 compilation**: Methods that cross a hotness threshold are compiled by the fast, lightly-optimizing C1 compiler. C1 inserts further profiling instrumentation.
3. **C2 compilation**: Methods that continue to be hot are recompiled by the aggressively-optimizing C2 compiler, which uses all accumulated profiling data to make inlining, devirtualization, branch prediction, and code layout decisions.
4. **Deoptimization**: If a speculative optimization proves wrong (e.g., a monomorphic call site becomes polymorphic), C2 deoptimizes back to interpretation, and the profile is updated.

This is the *receipt feedback loop* in its purest form: every execution produces telemetry that feeds the next compilation tier. HotSpot never commits to a single compilation for all time — it continuously re-evaluates based on observed behavior.

The critical insight for Tribunus is the *speculation + deoptimization* pattern. HotSpot speculates (e.g., "this virtual call always goes to class Foo") and generates optimized code under that assumption. If the assumption holds, performance is excellent. If it fails, deoptimization prevents incorrect results. Tribunus could apply this to backend selection: "For this model on this device, custom Metal beats MLX for attention." If a future device revision or OS update changes the performance characteristics, the compiler can deoptimize (re-benchmark) and update the compute image.

### 3.2 LLVM PGO (Profile-Guided Optimization)

LLVM PGO follows a three-phase cycle:

1. **Instrumentation build**: Compile with `-fprofile-instr-generate`. The compiler inserts edge/block counters. Compile time increases 10-60% and the binary runs 1.5-20x slower during profiling.
2. **Profile collection**: Run the instrumented binary on representative workloads. Generates `.profraw` files.
3. **Feedback compilation**: Merge profiles with `llvm-profdata` into `.profdata`, then recompile with `-fprofile-instr-use`. The compiler uses the profile to guide inlining, block ordering, branch prediction, register allocation, and function splitting.

The recompiled binary can be 10-30% faster than an unprofiled build. LLVM also demonstrates that PGO applied to the compiler itself (`clang` compiled with PGO) can reduce *compile time* by 10-22%, creating a virtuous cycle.

**Takeaway for Tribunus**: LLVM PGO's three-phase cycle maps directly to Tribunus' compilation pipeline: (Phase 1) generate candidates and insert measurement hooks → (Phase 2) run on device with real model dimensions → (Phase 3) merge receipts into the compute image, selecting winners. The key difference is that Tribunus profiles *kernel variants* rather than basic blocks, but the feedback-compilation cycle is structurally identical.

### 3.3 TensorRT Timing Cache

TensorRT's timing cache is the most directly relevant precedent for Tribunus' assessment freezing. During engine building, TensorRT profiles each candidate kernel on the actual GPU, records the timing, and caches the results. On subsequent builds with the same layer configuration, device, and TensorRT version, the cache hit avoids re-profiling. The cache is serializable and portable across machines with identical GPU SKUs.

**Takeaway for Tribunus**: Tribunus' compute image should embed an assessment receipt database structured as:

```
receipt = {
    phase_hash: SHA256(canonical_op, dims, dtype, layout),
    candidates: [
        { backend: "metal_custom", lat_us: 12.3, mem_bytes: 4096 },
        { backend: "mlx_graph",    lat_us: 15.1, mem_bytes: 8192 },
        { backend: "coreml_ane",   lat_us: 8.7,  mem_bytes: 2048 },
        { backend: "accelerate",   lat_us: 45.2, mem_bytes: 16384 },
        { backend: "rust_fallback",lat_us: 120.0, mem_bytes: 32768 },
    ],
    winner: "coreml_ane",
    device: "M3 Pro",
    os_version: "macOS 15.0",
    timestamp: "2026-06-18T12:00:00Z",
}
```

The timing cache should be shared across users of the same hardware through a content-addressable store — model authors compile once, all deployments on the same silicon reuse the receipts.

---

## 4. Shape Families, Not One Kernel

### 4.1 TensorRT Optimization Profiles

TensorRT's optimization profile mechanism is the most mature implementation of shape families. Each profile defines `[MIN, OPT, MAX]` for every dynamic dimension. TensorRT generates kernels optimized for OPT but valid across the MIN-MAX range. Multiple profiles can coexist in a single engine, and the runtime selects the appropriate one.

For LLM inference, the shape dimensions of interest are:

| Phase | Dynamic Dimensions |
|-------|-------------------|
| Prefill | batch, prompt_length |
| Short decode | batch (=1 typically), kv_cache_length |
| Long decode | batch, kv_cache_length (much larger) |
| Verifier window | batch, window_width (2, 4, 8, 16) |
| Sparse attention | batch, block_size, sparsity_pattern |

TensorRT's approach enables Tribunus to generate a *family* of kernels for each phase, each family member optimized for a specific shape regime, and the runtime dispatches to the appropriate member based on the actual input dimensions.

### 4.2 XLA Shape Specialization

XLA's shape specialization model is instructive in its limitations. XLA historically specializes every compiled executable to *concrete* input shapes. If the shape changes, XLA recompiles — creating a new executable variant. This creates a proliferation problem for variable-length workloads like LLM prefill. The standard production mitigation is *shape bucketing*: pad inputs to one of a small set of canonical shapes (e.g., sequence lengths 128, 256, 512, 1024, 2048, 4096), pre-compile those shapes, and accept the padding overhead of up to ~50% wasted compute in the worst case.

OpenXLA/StableHLO now supports *bounded dynamism* (symbolic dimensions with upper bounds), but the ecosystem support is incomplete — even with shape-polymorphic export, backend compilation often still generates per-concrete-shape variants. The practical advice from the XLA ecosystem is: bucket aggressively and warm up all expected shape combinations.

**Takeaway for Tribunus**: Tribunus' approach of generating "multiple kernel variants for different shape regimes" is exactly the XLA bucket pattern, but made explicit in the compiler architecture rather than a user-managed workaround. Tribunus should declare shape family axes explicitly:

```
shape_family = {
    axis: "window_width",
    values: [2, 4, 8, 16],
    strategy: "separate_kernel",  // vs "single_kernel_with_guard"
}

shape_family = {
    axis: "kv_cache_length",
    values: [128, 256, 512, 1024, 2048, 4096, 8192],
    strategy: "separate_kernel",
}
```

Each (phase, shape_family_member) pair becomes a separate compilation key, and each gets its own set of backend candidates assessed independently. This avoids the "one kernel that's mediocre for all shapes" problem while keeping the variant count manageable (e.g., 7 sequence lengths x 4 window widths = 28 variants for the verifier phase, not thousands).

### 4.3 Halide Exhaustive Search

Halide's AutoScheduler explores shape sensitivity explicitly: it can generate different schedules for different input sizes because the optimal tile size, unroll factor, and vectorization width depend on the tensor dimensions. Halide's approach is to *measure on representative sizes* and use a cost model to interpolate/extrapolate for unseen sizes — this is more scalable than exhaustive per-shape benchmarking.

**Takeaway for Tribunus**: For shape regimes where full per-shape assessment is impractical (e.g., arbitrary prompt lengths between bucketed values), a cost model trained on the bucket measurements can interpolate to choose the best fallback. The cost model should be part of the receipt database — updated as new receipts accumulate.

---

## 5. Fused Region Binaries

### 5.1 The Unit of Compilation is a Region, Not an Op

The fundamental insight across all modern inference compilers is that op-by-op execution is bandwidth-bound and latency-expensive. The unit of compilation should be a *region* — a subgraph of operations that can be fused into a single kernel, keeping intermediate tensors in registers or shared memory rather than round-tripping through global memory.

Examples from Tribunus' domain:

| Region | Ops Fused | Rationale |
|--------|-----------|-----------|
| RoPE + KV write | Rotary position embedding + key/value cache update | Avoids materializing intermediate RoPE output; writes rotated K/V directly to cache |
| RMSNorm + residual + quantize tile prep | Normalization + residual add + quantization scale computation | Single pass over the tensor; all three ops are memory-bound, not compute-bound |
| Attention tile matmul + softmax + scale | QK matmul, scale, softmax | Classic FlashAttention pattern; avoids materializing the full NxN attention matrix |
| FFN block | Two linear projections + activation + residual | Common transformer block fusion |

### 5.2 Existing Fusion Approaches

**TASO (Tensor Algebra SuperOptimizer)**: Automatically generates and *formally verifies* graph substitutions. TASO takes operator specifications and enumerates equivalent computation graphs through algebraic rewriting. It then uses cost-based search to select the optimal fused graph. TASO achieves up to 3x improvement over manual fusion rules. The verification step is critical — TASO proves that each substitution preserves semantics.

**Rammer**: Generates static spatio-temporal schedules for massively parallel accelerators. Rammer's key insight is that both *inter-operator* parallelism (running independent ops concurrently) and *intra-operator* parallelism (parallelizing within an op) must be co-scheduled. Rammer introduces hardware-neutral abstractions for computation tasks, enabling a unified schedule that outperforms both XLA and TVM on certain workloads.

**Nimble**: Targets *dynamic* neural networks with control flow and variable shapes. Nimble uses a dynamic type system and a lightweight VM runtime to handle models that traditional static compilers cannot. This is relevant for Tribunus' verifier phase, where the computation graph may vary based on speculative token acceptance patterns.

**TensorIR (Apache TVM)**: Represents tensor programs as first-class loop nests with explicit hardware acceleration annotations (threading, vectorization, memory scopes). TensorIR enables automatic optimization through a *schedule transformation* API: apply tiling, then binding, then vectorization — each transformation is a composable function on the IR.

**Ansor**: Beyond operator-level scheduling, Ansor's task scheduler partitions the model into subgraphs and allocates tuning time budget strategically. This is the "which regions to fuse" decision — Ansor identifies fusion opportunities that maximize end-to-end speedup rather than optimizing ops in isolation.

### 5.3 Operator Fusion Mechanics

The mechanics of operator fusion (also called kernel fusion or graph fusion) are well understood:

1. **Horizontal fusion**: Merge independent operations that share inputs (e.g., compute Q, K, V projections in one kernel).
2. **Vertical fusion**: Merge producer-consumer chains (e.g., LayerNorm → Linear → GELU).
3. **Multi-output fusion**: Produce multiple output tensors from one kernel to avoid redundant memory reads.

Fusion reduces memory bandwidth pressure and kernel launch overhead. On Apple Silicon's unified memory architecture, the benefit is primarily *bandwidth savings* (no DRAM round-trips for intermediates) rather than *copy elimination* (there are no CPU-GPU copies to eliminate). The GPU's tile memory (threadgroup memory in Metal) serves as the fast scratchpad for fused region intermediates.

**Takeaway for Tribunus**: Tribunus' fused region approach should:

1. **Define regions declaratively**: A region is a DAG of canonical ops with a single entry and one or more exits. The compiler should automatically detect fusion opportunities from the model graph using pattern matching (e.g., "LayerNorm followed by Linear with no other consumers" → fuse).

2. **Generate region candidates per backend**: For each region, generate: (a) a fused Metal compute kernel with tile-memory staging, (b) an MLX graph (which may fuse internally), (c) a Core ML MIL program, (d) a sequence of Accelerate calls with manual buffer reuse.

3. **Use TASO-style verification**: When fusing ops into novel regions, verify semantic equivalence. This is especially important for numeric stability — fused LayerNorm+quantization must produce bit-identical results to the unfused sequence at the quantization boundaries.

4. **Co-schedule like Rammer**: For multi-region models, schedule independent regions to run concurrently on different compute units (ANE for CNN-like regions, GPU for attention, CPU for token dispatch).

---

## 6. Receipt Feedback Loop

### 6.1 AutoTVM's Cost Models

AutoTVM's iterative profile-refine-sample loop is the prototype for receipt-driven compilation. Every profiling run produces a data point: (candidate_schedule, measured_latency). These data points train a cost model that predicts the latency of *unmeasured* candidates. The cost model enables the compiler to search a much larger space than it could afford to fully benchmark.

The cost model is not static — it improves with each compilation, and the improvement is *transferable* across models that share operators. AutoTVM stores historical tuning logs that accelerate future tuning tasks.

**Takeaway for Tribunus**: The receipt database should feed two consumers:
- **Direct lookup**: "Has this exact (phase, shape, backend, device) combination been assessed before? Use the cached winner."
- **Cost model training**: "Given receipts for similar phases on similar devices, predict the best backend for this new phase without full assessment."

### 6.2 TensorRT's Timing Cache

TensorRT's timing cache is the simplest and most robust form of receipt feedback: serialize profiling results, reuse on cache hit, re-profile on cache miss. The cache key includes the layer configuration, data types, device identity, and TensorRT version. This is essentially a content-addressable store.

**Takeaway for Tribunus**: The compute image itself should act as the timing cache. A compute image is an immutable artifact containing:

```
compute_image = {
    model_hash: SHA256(model_weights),
    regions: Map<RegionId, {
        shape_families: Map<ShapeFamilyId, {
            winner: BackendId,
            receipts: [Receipt],
        }>,
    }>,
    metadata: { device, os_version, compiler_version },
}
```

When a new model version is deployed, only regions whose hash changed need re-assessment. Regions with identical hashes reuse the previous winners.

### 6.3 Java HotSpot Tiered Compilation

HotSpot's continuous profiling and tiered recompilation demonstrates a more dynamic feedback loop than batch PGO. The JVM does not wait for a separate "profile collection" phase — it interleaves profiling with execution. Methods start interpreted, get compiled at tier 1 (C1) with profiling, and can be recompiled at tier 4 (C2) based on accumulated profiles. If the profile changes (e.g., a new code path becomes hot), the method can be deoptimized and recompiled.

**Takeaway for Tribunus**: For long-running inference servers, Tribunus could implement a *continuous re-assessment* mode:

1. Start with the frozen compute image (fast, pre-assessed winners).
2. In the background, re-assess alternative candidates on the actual running device with actual runtime shapes.
3. If a new candidate consistently beats the current winner by a threshold (e.g., >10% latency improvement), update the compute image atomically.
4. If a macOS update or thermal throttling changes the performance landscape, the receipts become stale, triggering re-assessment.

This is speculative — the initial Tribunus design should focus on the batch compilation model (compile once, freeze, deploy). But the architecture should not foreclose online re-assessment.

### 6.4 LLVM PGO Cycle

LLVM PGO demonstrates that the instrumentation overhead for profiling can be substantial (1.5-20x slowdown), but the final optimized binary can be 10-30% faster. The key architectural decision for Tribunus is: *when does profiling happen?*

- **Option A: Offline profiling at model authoring time**. The model author runs the assessment phase on representative hardware, freezes the compute image, and distributes it. This is the TensorRT model — fast deployment, no runtime overhead.

- **Option B: Online profiling at first inference**. The runtime benchmarks candidates on the actual device on first use, caches results, and uses them for subsequent inferences. This is the JIT warmup model — slow start, adapts to the actual hardware.

- **Option C: Hybrid**. Model authors pre-assess on common hardware (M1/M2/M3/M4 families) and ship a fat compute image with receipts for known devices. On unknown devices, fall back to online assessment with a reduced candidate set (skip the slowest-generating candidates).

**Recommendation for Tribunus**: Implement Option C. The bulk of the assessment cost is amortized across deployments, but the system degrades gracefully on new hardware.

---

## 7. Synthesis: Recommended Architecture for Tribunus

### 7.1 Compilation Pipeline

```
Model (weights + graph)
    │
    ▼
┌─────────────────────────────────┐
│ Phase 1: Graph Decomposition    │
│ - Identify canonical phases     │
│ - Detect fusion opportunities   │
│ - Enumerate shape families      │
│ - Pre-declare all memory        │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ Phase 2: Candidate Generation   │
│ Per (phase, shape_family):      │
│ - Custom Metal kernel           │
│ - MLX graph (lazy)              │
│ - MPSGraph kernel               │
│ - Core ML / MIL island (ANE)    │
│ - Accelerate vDSP recipe        │
│ - Rust fallback                 │
│ Cost model prunes candidates    │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ Phase 3: Assessment             │
│ - Compile surviving candidates  │
│ - Benchmark on actual device    │
│ - Record receipts in DB         │
│ - Freeze winners                │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ Phase 4: Compute Image Emission │
│ - Bundle winning kernels        │
│ - Embed region dispatch table   │
│ - Sign and version image        │
└──────────────┬──────────────────┘
               │
               ▼
          Compute Image
```

### 7.2 Key Design Decisions

1. **Schedule-agnostic IR**: Adopt an MLIR-based intermediate representation (possibly a custom dialect extending StableHLO or Linalg) that separates what a region computes from how each backend implements it. This is the prerequisite for candidate generation — without it, you cannot vary the schedule independently of the computation.

2. **Receipt database as content-addressable store**: Every assessment run produces a receipt keyed by (phase_hash, shape_hash, backend, device_fingerprint). Receipts are immutable and shareable. The cost model is continuously trained on accumulated receipts.

3. **Shape family axes are first-class**: The compiler should explicitly model shape families as axes with discrete values. Each combination of (phase, shape_family_values) is a separate compilation unit with its own set of candidates and its own assessment. The runtime dispatcher is a lookup table — no dynamic decisions at inference time.

4. **Region fusion with formal verification**: Fuse aggressively but verify. TASO's formal verification approach is the gold standard. For numeric stability concerns (especially with quantization boundaries), the verification should include bit-exactness checks at the tensor element level for a representative input set.

5. **Persistence and incrementality**: The compute image is not a black box. It includes the full assessment receipt database, enabling incremental recompilation — change one layer, re-assess only the regions that contain it. TensorRT's timing cache pattern is the model.

6. **No ideology in backend selection**: The compiler records what wins, not what should win. If custom Metal beats MLX for attention on M3 but loses on M4, the receipts reflect that. If Accelerate beats Rust for BLAS-3 but Rust wins for small matmuls, the receipts reflect that. The design must resist the temptation to hard-code backend preferences.

### 7.3 Open Questions for Further Research

1. **ANE targeting**: The ANE's programming model is not publicly exposed through a general-purpose API. Core ML is the gateway, and its "all-or-nothing" subgraph compatibility means Tribunus must carefully partition the model graph into ANE-compatible and ANE-incompatible regions. Research needed: what transformer subgraphs are ANE-compatible on current hardware?

2. **Cost model architecture**: What features predict kernel latency on Apple Silicon? Candidate features: FLOP count, arithmetic intensity, memory footprint, register pressure, Metal occupancy, ANE compatibility flags, historical receipt data. The cost model should be lightweight enough to run during compilation without dominating the assessment phase.

3. **Metal kernel generation**: How to automatically generate high-quality Metal Shading Language kernels without per-operator expert templates? Ansor's automatic search space construction is the template, but porting it to Metal's threadgroup and SIMD-group programming model requires research.

4. **Continuous re-assessment**: Is online re-benchmarking during inference serving viable, or does it introduce unacceptable latency jitter? HotSpot demonstrates that it can work for CPU code, but GPU/ANE benchmarking has different timing characteristics.

5. **Cross-device receipt sharing**: Can receipts from an M3 Pro be reused on an M3 Max (same generation, different core count)? What about M2 to M3 (different generation)? The cost model should predict cross-device transferability.

---

## 8. References

- TVM Ansor: Zheng et al., "Ansor: Generating High-Performance Tensor Programs for Deep Learning," OSDI 2020.
- TVM AutoTVM: Chen et al., "Learning to Optimize Tensor Programs," NeurIPS 2018.
- Halide: Ragan-Kelley et al., "Halide: A Language and Compiler for Optimizing Parallelism, Locality, and Recomputation in Image Processing Pipelines," PLDI 2013.
- MLIR: Lattner and Pienaar, "MLIR: A Compiler Infrastructure for the End of Moore's Law," arXiv:2002.11054.
- TASO: Jia et al., "TASO: Optimizing Deep Learning Computation with Automatic Generation of Graph Substitutions," SOSP 2019.
- Rammer: Ma et al., "Rammer: Enabling Holistic Deep Learning Compiler Optimizations with rTasks," OSDI 2020.
- Nimble: Shen et al., "Nimble: Efficiently Compiling Dynamic Neural Networks for Model Inference," MLSys 2021.
- TensorRT: NVIDIA TensorRT Developer Guide, https://docs.nvidia.com/deeplearning/tensorrt/
- XLA/OpenXLA: https://openxla.org/
- Java HotSpot: Paleczny et al., "The Java HotSpot Server Compiler," JVM'01.
- LLVM PGO: https://llvm.org/docs/HowToBuildWithPGO.html
