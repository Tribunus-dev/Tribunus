# ADR 0037: Backend Realization Contract

## Status
Proposed — June 2026

## Context

The preceding ADRs define a compiled inference architecture (0034), model virtual memory (0035), and arena/ring/lease runtime (0036), but they assume that backends are uniform targets — any backend can execute any phase with consistent semantics. This assumption fails in practice. Each backend supports different operations, dtypes, layouts, memory models, dynamic shape regimes, and numerical precision profiles. A formal contract is needed.

## Decision

Define the BackendRealizer trait and the BackendCapability schema as the universal interface between PhaseIR and concrete device executables.

### Three-Tier Architecture for Multi-Backend Compilation

Tier 1 — Canonical PhaseIR: matmul, attention, norm, activation, rope, dequant, KV write/append/view, sampling, gather/scatter, reshape. PhaseIR is the semantic contract — it does not specify how, only what.

Tier 2 — Backend Realizers: Each backend has a Realizer that accepts a PhaseIR region and returns a candidate executable. Realizer types: MLXMetalRealizer (Metal JIT), TritonRealizer (portable, NVIDIA/AMD/Intel), cuBLASLtRealizer (NVIDIA matmul), CUTLASSRealizer (NVIDIA fused), rocBLASRealizer (AMD matmul), oneDNNRealizer (Intel), VulkanRealizer (survival), TTNNRealizer (Tenstorrent), CPUScalarRealizer (always available).

Tier 3 — Runtime Realization: Memory allocation, command submission, cache lookup, tuning records, telemetry, fallback.

### BackendRealizer Trait

```rust
pub trait BackendRealizer: Send + Sync {
    fn name(&self) -> &str;
    fn capabilities(&self) -> &BackendCapability;

    /// Accept a PhaseIR region, return a candidate executable
    fn realize(&self, phase: &PhaseIR, constraints: &Constraints) -> Result<CandidateExecutable>;

    /// Classify this phase into operation/dtype/layout triplet
    fn classify_phase(&self, phase: &PhaseIR) -> PhaseClass;

    /// Return estimated latency for a given phase (used by scheduler)
    fn estimate_latency(&self, phase: &PhaseIR) -> Duration;

    /// Check if this realizer can handle the operation with given constraints
    fn can_handle(&self, op: &str, dtype: DataType, layout: Layout) -> bool;
}
```

### BackendCapability Schema

```
identity: kind, vendor, architecture, driver_version_min
memory_model: max_allocation_size, page_size, supports_unified_memory, supports_host_pinned, supports_peer_access
dtype_support: native_dtypes[], quantized_dtypes[]
operation_catalog: operations[] with variants[] (input_dtypes, rank_range, alignment, max_shared_memory, roofline_flops)
aliasing_contract: output_may_alias_input, in_place_supported[], automatic_copy_insertion
shape_contract: static_only, fully_dynamic, bounded_dynamic, dynamic_axes[] (min/opt/max), requires_shape_recompile
mutation_contract: append_semantics (block_table/contiguous/copy_reallocate), supports_paged_attention, page_size
numerical_contract: default_precision, minimum_precision, ulp_error_bound per (op, dtype)
async_contract: supports_streams, max_concurrent_kernels, command_list_model (immediate/batched/graph)
graph_contract: supports_graph_capture, graph_update_supported, capturable_node_types[]
```

### Per-Backend Strategies

**NVIDIA:** Track A (cuBLASLt matmul + Triton attention + monolithic CUDA Graphs, 3-4 wks). Track B (CUTLASS fused kernels + piecewise CUDA Graphs + NCCL, +8-12 wks). Do NOT start with handwritten CUDA for everything.

**AMD:** Triton HIP first for matmul/attention/norm. rocBLAS/hipBLASLt for standard GEMM where Triton doesn't match. Vulkan for consumer RDNA3 survival. ROCm 7+ with AOTriton for production.

**Intel:** Three-tier approach: Triton XPU for portable kernels, oneDNN for matmul/norm/attention primitives, SYCL escape hatch. Level Zero immediate command lists for lowest dispatch latency. Intel XPU Triton backend via intel/intel-xpu-backend-for-triton fork.

**Tenstorrent:** TT-NN operators for standard phases (~200+ ops). TT-Metalium reader/compute/writer programs for custom phases (MoE routing, speculative tree attention). Not a Triton target — separate lowering family via TT-MLIR.

**MLX (Apple):** Frontend graph interception — captures MLX lazy DAG before eval, serializes as PhaseIR. MLX remains Apple inference backend. Graph interception via 6 C API additions to mlx-c.

### Memory Semantics Contract

- Stride capability predicates per backend: contiguous_row, contiguous_col, negative_strides, max_vector_stride
- Stride normalization pass before PhaseIR lowering
- Shape buckets: 3-bucket minimum (128, 2048, 32768) or 7-bucket practical (32, 128, 512, 2048, 8192, 32768, 131072)
- Paged KV cache with block_table indirection as default
- Aliasing policy: matmul output != input, elementwise may alias

### Autotuning Cache

6-tier composite key: graph_hash, shape_bucket, dtypes, device, software_env, optimization_context.
Stored at ~/.cache/tribunus/tuning.db (SQLite).
Every compute image includes tuning_manifest.json with selection evidence.
Community sharing: hashed manifest upload only.

### Failure Taxonomy

Every Realizer must report why a phase cannot be realized:
- `unsupported_dtype`, `unsupported_layout`, `unsupported_mutation`, `unsupported_dynamic_shape`
- `compile_failed`, `load_failed`, `numerical_divergence`, `performance_regression`
- `replay_invalid`, `cache_key_mismatch`, `runtime_driver_fault`

### Admission Standard

A backend candidate is admitted only after: reference oracle check, layout/view check, shape-bucket check, warm/cold timing check, replay check, cache-key reproducibility check.

### Compile Time as First-Class Metric

Cold compile time, warm load time, and amortization threshold stored alongside latency and throughput.

### PhaseIR Memory and Mutation Semantics

KvWrite, KvAppend, KvView carry explicit ownership, aliasing, layout, synchronization. Backends rejecting in-place mutation route through copy-on-write.

### Evidence-Producing Candidate Factory

BackendRealizer is not a backend interface. It is an evidence-producing candidate factory. Realizers produce candidates. Compiler admits candidates. Runtime replays admitted candidates. Compute image freezes evidence, not just code.

## Consequences

- NVIDIA Track A: 3-4 weeks. Track B: +8-12 weeks.
- AMD (Triton HIP + rocBLAS): 4-6 weeks.
- Intel (Triton XPU + oneDNN + Level Zero): 4-6 weeks.
- Tenstorrent (TT-NN + TT-Metalium): partnership-shaped (hardware required).
- Shared: memory semantics + autotuning + BackendRealizer trait: 4-6 weeks.
