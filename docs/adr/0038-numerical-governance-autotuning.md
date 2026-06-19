# ADR 0038: Numerical Governance and Autotuning

## Status
Proposed — June 2026

## Context

Portable inference compilers die by silent numerical drift. A kernel that runs on NVIDIA Tensor Cores may produce different logits than the same kernel on AMD WMMA or Intel XMX. Without a formal numerical contract, the compiler cannot distinguish "correct" from "close enough to not matter." Autotuning requires an evidence infrastructure that tracks what was selected, why, and on which hardware.

## Decision

### Four-Tier Numerical Oracle

Apple Silicon (MLX Metal + Accelerate FP32 accumulation) serves as the reference truth source for all backends because it has well-defined Metal FP32 accumulation semantics and no fast-math footguns.

| Tier | Method | Scope |
|---|---|---|
| 0 | Reference computation on Apple Silicon | All backends |
| 1 | Per-operator assert_allclose with dtype x operation tolerance | Individual op outputs |
| 2 | Cosine similarity per fused region | Fused kernel outputs |
| 3 | End-to-end top-k logit match rate | Full forward pass |
| 4 | Token acceptance rate in speculative decode | Autoregressive decode |

### Tolerance Matrix

Values represent maximum absolute difference per output element. Tighter than FP32 error bounds to account for accumulation differences.

| Operation | FP32 | FP16 | BF16 | INT8 | INT4 | FP8 |
|---|---|---|---|---|---|---|
| Elementwise | 1e-6 | 1e-3 | 1e-3 | 1e-1 | — | 1e-2 |
| Matmul | 1e-4 | 1e-2 | 1e-2 | 1e-1 | 2e-1 | 1e-1 |
| Softmax | 1e-3 | 1e-2 | 1e-2 | 1e-1 | — | 1e-1 |
| Attention | 1e-2 | 1e-1 | 1e-1 | 2e-1 | — | 2e-1 |
| RMS Norm | 1e-5 | 1e-3 | 1e-3 | 1e-1 | — | 1e-2 |
| RoPE | 1e-5 | 1e-3 | 1e-3 | — | — | — |
| Activation | 1e-5 | 1e-3 | 1e-3 | 1e-1 | — | 1e-2 |

Softmax is intentionally looser (50x vs elementwise) because exp/sum accumulation amplifies rounding differences. Attention is looser than matmul because attention scores are used through softmax which masks small differences.

### Autotuning Cache

6-tier composite key:
1. Graph hash (PhaseIR topology)
2. Shape bucket (prefill 128 / decode 2048 / long 32768)
3. Input/output dtypes
4. Device model + compute capability
5. Driver version + runtime version + OS
6. Optimization context (latency vs throughput, fusion budget)

Cache database: `~/.cache/tribunus/tuning.db` (SQLite). Key queries O(1) via hash index.

### Evidence in Compute Image

Every compiled compute image includes `tuning_manifest.json`:
```json
{
  "phases": [{
    "phase_hash": "...",
    "backend": "vulkan",
    "selected_realizer": "TritonRealizer",
    "evidence": {
      "latency_us": 1234,
      "throughput_tok_s": 45.6,
      "gflops": 12.3,
      "numerical_oracle": {
        "max_error": 0.012,
        "cosine_similarity": 0.9999,
        "top5_match": 0.98
      }
    },
    "environment": {
      "device": "AMD Radeon RX 7900 XTX",
      "driver_version": "mesa 24.2.0",
      "runtime_version": "triton 3.3"
    }
  }]
}
```

### Admission Standard

A backend candidate is frozen into the compute image only after all of:
1. **Oracle check:** Per-op tolerance matrix passes (dtype x operation)
2. **Layout/view check:** Non-contiguous strides, transposed views, broadcasts produce correct output
3. **Shape-bucket check:** All shape regimes pass (prefill, short decode, long decode)
4. **Timing check:** Both first-run (cold compile) and steady-state (warm replay) latency recorded
5. **Replay check:** Deterministic output across multiple executions
6. **Cache-key check:** Same candidate reproducible from same cache key

The compute image freezes the evidence, not just the code. Every compiled phase includes: which Realizer produced it, why it was selected, oracle results, timing profiles, cache key, environment fingerprint, and signature.

### Regression Harness

- On backend driver/runtime update: benchmark all cached phases, detect >20% performance regression
- On regression: trigger recompilation with degraded-path fallback
- Report: compare against baseline tuning manifest from last clean run

### Receipt-Based Verification

- Runtime receipts compared to expected-receipt profile in compute image
- Deviation (wrong backend, unexpected fallback, latency 3x expected) marks golden path degraded
- Degraded path triggers reassessment or falls back to CPU reference

## Consequences

- Positive: Numerical trust across diverse backends. Reproducible compute images. Community tuning sharing.
- Negative: Tuning overhead at compile time. Large manifest on first compile. Oracle runs on Apple Silicon, so Linux-only users need a reference machine.
- Effort: 3-4 weeks for full tuning infrastructure. 1 week for oracle. 1 week for cache. 1 week for regression harness. 1 week for receipt comparison.
