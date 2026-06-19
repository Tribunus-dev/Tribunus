# Numerical Oracle and Autotuning Research

## Numerical Verification (4-Tier)
| Tier | Method | Apply to |
|---|---|---|
| 0 | Reference: Apple Silicon FP32 accumulation via MLX/Accelerate | All backends |
| 1 | Per-op absolute/relative diff with dtype-aware tolerance | Individual operation outputs |
| 2 | Cosine similarity per fused region | Fused kernel outputs |
| 3 | End-to-end top-k logit match rate | Full forward pass |
| 4 | Token-perceived quality (speculative acceptance rate) | Autoregressive decode |

## Tolerance Matrix (per-op, per-dtype)
| Operation | FP32 | FP16 | INT8 | INT4 |
|---|---|---|---|---|
| Elementwise | 1e-6 | 1e-3 | 1e-1 | N/A |
| Matmul | 1e-4 | 1e-2 | 1e-1 | 2e-1 |
| Softmax | 1e-3 | 1e-2 | 1e-1 | N/A |
| Attention | 1e-2 | 1e-1 | 2e-1 | N/A |
| RMS Norm | 1e-5 | 1e-3 | 1e-1 | N/A |

Values represent: max(absolute_difference) per operator output element.

## Autotuning Cache Schema
6-tier composite cache key:
1. `graph_hash` — hash of canonical PhaseIR graph structure (topology only, not shapes)
2. `shape_bucket` — prefill/decode/long-context bucket identifier
3. `dtypes` — input/output activation dtypes
4. `device` — device model, compute capability, memory config
5. `software_env` — driver version, runtime library versions, OS
6. `optimization_context` — fusion policy, budget, latency vs throughput target

Cache stored at `~/.cache/tribunus/tuning.db` (SQLite)
Every compiled compute image includes `tuning_manifest.json`:
- phase hash, backend, selected realizer, evidence logs (latency, throughput, firmware profile), environment fingerprint, signature

## Community Sharing
Opt-in sharing: hashed manifest upload (no raw weights). Allows community to benefit from tuning done on similar hardware configurations.
