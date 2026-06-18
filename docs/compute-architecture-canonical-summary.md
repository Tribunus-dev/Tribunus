# Tribunus Compute Architecture Canonical Summary

## Core Thesis

Backend optimality must be compiled, not improvised.

Assessment measures real backend behavior on the current machine topology. Compilation emits a machine-specific compute image with prequalified backend regions and a placement manifest. Inference executes a deterministic state machine over backend lanes and memory-page leases. Receipts verify actual execution, fallback behavior, copy bytes, page lifecycle, latency, and numerical correctness.

## Current State (June 2026)

### What Works

Tribunus Compute runs on Apple Silicon via three backends: MLX Metal (GPU), Accelerate (CPU), and CoreML (ANE). The architecture uses a precompiled compute image model — the model is compiled into an executable golden path with known shapes, placement, and memory layout before inference begins. The runtime is closer to "lease page, submit known backend region, fence, advance state" than "run dynamic tensor program."

SharedMemoryIsland is on by default. ANE prewarm is called during model initialization. The profiled execution path receives the memory island. The heterogeneous Tokio scheduler manages memory and backend lifecycle.

### Actual Measured Performance (M1 base, Qwen 2.5 0.5B)

| Phase | Tokens/sec | What it means |
|---|---|---|
| 65 tok/s | Current custom baseline | Custom MLX-heavy runtime with heterogeneous scaffolding |
| 100-160 tok/s | Arena/residency working | Zero-copy arena, paged residency, fused backend regions are working |
| 180-280 tok/s | Speculation working | Speculative decode with decent acceptance rate |
| 300+ tok/s | Full stack clicking | Draft model, verifier batching, Core ML region fusion, KV transactions cooperating |

### What Does NOT Yet Work (the gap)

The hot path still contains fallback-like behavior:

- **Accelerate dispatch** still evaluates MLX tensors, extracts slices, and copies into host Vec before calling Accelerate-style operations. It should receive resident pages and operate in-place.
- **Core ML / ANE paths** still do explicit extraction and copying in places. Core ML should receive fused MIL islands large enough to amortize boundary costs, not tiny ad hoc ops.
- **SharedMemoryIsland** accepts arbitrary MLX dtypes, but Arena::new supports only Float16. Some dispatch paths ask for Float32 output arenas, causing silent fallback.
- **No per-token receipts.** The runtime cannot distinguish "golden path executed" from "correct output happened through fallback."

### 30-80 Nanosecond Orchestration

The low orchestration latency numbers should be understood as arena handoff overhead, not full Core ML / ANE island execution latency. The full backend island is still bounded by framework scheduling, execution, and fence visibility. The design is valid: Tribunus is not making generic Core ML faster; it is turning a model into a machine-specific executable where Core ML is one pre-bound island inside a scheduler-controlled compute image.

## Architecture Layers

### Layer 0: Assessment

Records which backend actually wins for each model family, shape class, sequence length, dtype, layout, and token phase on the current machine. Assessment discovers backend truth. Runs during compute-image compilation, not during inference.

### Layer 1: Compilation

Emits a placement manifest:
- Which phases run on MLX (Metal GPU)
- Which fused regions run on Core ML (ANE / MIL islands)
- Which recipes run through Accelerate (CPU deterministic helpers)
- What pages each phase reads and writes
- What fallbacks are legal
- Which receipts must be emitted

Also generates candidate custom Metal kernels during compilation, benchmarks and validates them on the current device during assessment, and freezes winning variants into the compute image. Runtime only selects from already-qualified kernels.

### Layer 2: Inference

Deterministic state machine over precompiled backend lanes and page leases. The runtime knows the model, shapes, phase schedule, placement, memory layout, and golden path before the first token is generated.

### Layer 3: Receipts

Per-token or per-region receipts showing:
- Which backend actually executed
- What native symbols were called
- How many bytes were copied
- Which arena allocations succeeded
- Whether Core ML / ANE prediction actually happened
- How many fallbacks occurred
- How long scheduler, backend, fence, and copy stages took

Without receipts, the runtime cannot distinguish "the golden path executed" from "correct output happened through fallback."

## Backend Roles

### MLX (Metal GPU)

MLX's lazy evaluation and Metal JIT behavior are the primary source of runtime waste. MLX is excellent as a flexible dynamic tensor runtime for experimentation — the opposite of what Tribunus Compute wants. During inference, MLX should not be discovering graphs, lazily compiling kernels, or allocating surprise temporaries.

The part worth keeping: the tailored Metal kernel generation capability. Steal the on-the-fly compiler of specialized Metal kernels, but move the compilation point to compute-image compilation time. Generate candidates, benchmark them, freeze the winners.

MLX becomes one backend lane, not the owner of inference.

### Core ML (ANE)

Not an operation backend. A compiled region backend.

Offloading tiny individual operations to Core ML is wrong. The compiler should create stable-shape MIL islands or mlpackages large enough to amortize boundary and fence costs. Core ML should receive:
- Fused regions
- Speculative proposal islands
- Attention/MLP fragments that compile well
- Verifier subregions

Not tiny ad hoc ops.

### Accelerate (CPU)

A fused execution recipe backend, not arbitrary custom kernels. Can chain vDSP, vForce, BLAS, LAPACK, BNNS over resident pages with preallocated scratch and no hidden allocation. Value is in deterministic low-latency CPU-side:
- Reductions and normalization
- Sampling helpers
- Checksums and validation
- Avoiding unnecessary MLX overhead where the residency contract is preserved

### Custom Metal Kernels (Compiled Regions)

A compiled region may lower to:
- A custom Metal kernel (precompiled, device-specialized)
- A precompiled Core ML MIL island
- An Accelerate recipe
- A model-agnostic Tribunus native kernel

The compiler defines the phase, inputs, outputs, layout, dtype, residency, latency budget, tolerance, and legal fallbacks. Backend candidates compete during assessment. The compute image freezes the winner.

## Forking MLX

Forking mlx, mlx-c, and mlx-rs is justified because the required changes are below the public abstraction layer. Tribunus needs authority over:
- Evaluation scheduling
- Output placement
- Allocator behavior
- Compiled-kernel cache behavior
- External IOSurface ownership
- Receipt emission

The fork must remain narrow and disciplined: make MLX obey the compute image's authority without becoming a long-term maintenance black hole.

## Speculative Decoding

The major performance multiplier.

Without speculation, fully wiring the zero-copy arena, paged ring buffers, Accelerate, Core ML, and MLX might take Qwen 2.5 0.5B from 65 tok/s into maybe 100-160 tok/s on M1. With speculation and proper verifier batching, the ceiling changes because the full model no longer produces every token sequentially.

### Draft Model

A speculative tiny submodel generated programmatically at compute-image compilation time based on the same model. Stronger than bolting on an unrelated draft model because it shares:
- Tokenizer and vocabulary projection shape
- RoPE convention
- KV layout and quantization metadata
- Architecture assumptions with the target model

This improves acceptance rates and allows the compiler to place the draft path where it makes sense.

### Tree Speculative Decoding (Not 16 Arbitrary Tokens)

Core ML / ANE produces a speculative candidate tree. MLX verifies the target model over a compact acceptance window.

The target model remains authoritative. The draft model proposes candidate branches. The verifier scores a packed candidate window, commits the longest accepted path, rolls back rejected pages.

### KV Transaction Model

Draft KV pages must never contaminate authoritative target KV unless accepted. Rejected branches roll back cleanly. Page generation counters prevent stale handles.

The speculative execution contract:
1. Reserve provisional pages
2. Run draft proposal
3. Run target verification
4. Commit accepted pages
5. Discard rejected pages
6. Increment generations for recycled pages

## Model-Agnostic Canonical Kernels

These turn Tribunus from a compiler for one model into a reusable inference-runtime primitive library:

- Multi-token prediction
- Sparse attention
- Paged KV operations
- KV compression / decompression
- Speculative branch commit / rollback
- Token-tree verification
- Block allocator generation checks

These become canonical Tribunus phases, not model-specific hacks.

## Performance Projections

### M1 Max

| State | Raw target tok/s | Effective (w/ speculation) |
|---|---|---|
| Today (partially wired) | 140-230 | — |
| Full compute-image plan | 250-450 | 500-900 |
| Everything clicked | — | 1000+ (trophy benchmark) |

### M5 Max

| State | Raw target tok/s | Effective (w/ speculation) |
|---|---|---|
| Full compute-image plan | 300-550 | 800-1600 |
| Everything clicked | — | ~2000 (trophy) |

## Tenstorrent Implications

### Architectural Convergence

Tribunus' architecture and Tenstorrent's Tensix dataflow are nearly isomorphic:

| Tribunus | Tensix |
|---|---|
| Operation graph (DAG + edges) | Reader/compute/writer dataflow |
| Ring buffer transport | SRAM circular buffers |
| Fusion planner | Fused kernels (stay on-core) |
| Placement/routing | NoC routing |
| Executor | tt_program_run |
| Compute island | Tensix core or Blackhole chip |
| Multi-island dispatch | Ethernet mesh |

This was convergent design — built independently, from first principles, without knowing the other existed.

### Readiness for Outreach

Not yet ready for a "the engine is working and just needs Blackhole hardware" pitch. Ready for warm technical outreach if framed honestly: Tribunus has an Apple-side compute-image compiler/runtime and wants to turn Tenstorrent into another measured backend substrate.

### Required Before Hardware Ask

1. Create a clear Tenstorrent backend bridge spec: map Tribunus phases to TT-NN / TT-Metalium primitives, define execution receipts for TT hardware, include a Linux host plan, show green contract-layer check independent of Apple-only dependencies
2. Get one operation (quantized_matmul) running on Blackhole via TT-Metalium from Tribunus IR
3. The initial ask should be modest: Blackhole dev card loan, one technical contact, permission to publish open bring-up diary
4. The larger ask (salary, engineering support) comes after a tiny TT-NN or TT-Metalium backend receipt exists

### What Tribunus Offers Tenstorrent

- A portable computation graph compiler that isn't PyTorch/TensorFlow-locked
- Golden path attested execution (signed plans, verifiable inference) — CUDA doesn't have this
- The same plans running on Apple Silicon, AMD, NVIDIA, and Tensix
- An independently designed inference engine whose abstractions match their silicon — convergent design evidence
- A RISC-V ecosystem adoption path via portable computation graphs

### Funding Path

Dev kit first (cold email to Jim Keller or TT-Forge team). Then prove the concept compiles (Week 1: quantized_matmul via TT-Metalium). Then make the financial ask: $12-15k/month for 6 months as independent researcher. Code stays AGPL open source.
