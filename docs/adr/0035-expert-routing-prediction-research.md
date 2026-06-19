# ADR 0035: Expert Routing Prediction Research — ANE-Based MoE Prefetching

## Status
Research Report — June 2026

## Purpose

Research whether the Apple Neural Engine (ANE) can serve as a speculation coprocessor for learned expert routing prediction in Mixture-of-Experts (MoE) models. The ANE would run a compact predictor model from the current hidden state or candidate tokens, enabling the scheduler to prefetch expert pages, warm compressed weight blocks, or reserve arena pages before the target verifier reaches that layer. This complements the weight paging system defined in ADR 0035 Pillar 2.

---

## 1. Known Methods for Expert Prediction

Seven distinct families of expert prediction exist, ordered from most directly applicable to ANE:

### 1.1 Fate — Cross-Layer Gate Prediction

**Paper:** Fang et al., "Fate: Fast Edge Inference of Mixture-of-Experts Models via Cross-Layer Gate," arXiv:2502.12224, February 2025.

**Mechanism:** The key insight is that adjacent-layer gate inputs have >83% average cosine similarity. Fate uses `Gate_in_i` (the input to the gate at layer i) to predict the top-k experts for layer `i+1`. The prediction runs on CPU while the GPU computes layer i. With a shallow-favoring expert cache, Fate achieves 97.15% prefetch accuracy and 99.08% cache hit rate. Speedups: up to 4.5x prefill and 4.1x decoding vs load-on-demand.

**ANE applicability:** HIGH. Fate's predictor is essentially a router clone — fetching `Gate_in_i` and running it through the next layer's gate weights. This is a single matrix multiply (hidden_size × n_experts) that maps perfectly to an ANE linear layer. No training required — reuses the existing router weights.

**Limitation:** Only predicts 1 layer ahead. Shallow layers are harder to predict (more uniform expert distribution). First MoE layer cannot be predicted from previous gate (no previous MoE layer).

### 1.2 Pre-Attention Expert Prediction (with Lightweight Routers)

**Paper:** "Pre-Attention Expert Prediction and Prefetching for Mixture-of-Experts Large Language Models," arXiv:2511.10676, November 2025.

**Mechanism:** Uses activations *before* the attention block in the *same* layer (post-LayerNorm, pre-self-attention) rather than from the previous layer. Two linear functions with a ranking-aware loss perform the prediction. The key insight is that certain functions in LLMs are "ranking-preserving" — simple linear functions can match expert rankings.

**Accuracy:** 93.03% on DeepSeek V2 Lite, 94.69% on Qwen3-30B, 97.62% on Phi-mini-MoE. This is approximately 15% absolute improvement over Fate (which reports ~78.8% on comparable benchmarks).

**ANE applicability:** HIGH. Two linear functions with a total of ~3.7M parameters (for DeepSeek V3 scale). INT8-quantized, this fits in ~3.5 MB. The ANE excels at exactly this kind of small, dense feedforward computation. The prediction can overlap with GPU attention computation since it uses pre-attention activations.

### 1.3 Pre-Gated MoE — Architecture-Modified Gate Chaining

**Paper:** Microsoft Research Asia, "Pre-gated MoE: An Algorithm-System Co-Design for Fast and Scalable Mixture-of-Expert Inference," ISCA 2024.

**Mechanism:** Modifies the model architecture itself: the gate in layer N directly selects experts for layer N+1. This decouples expert selection from execution, enabling CPU→GPU migration to overlap with current-layer computation. Requires training a new model with the pre-gate architecture.

**ANE applicability:** LOW. Requires modifying model architecture and retraining. Not applicable to existing checkpoints. However, the concept of *chaining* gate predictions (layer N predicts N+1, which predicts N+2, etc.) is re-usable even without architecture changes — a cascaded ANE predictor could chain predictions 2-3 layers ahead.

### 1.4 MoE-SpeQ — Speculative Decoding with Draft Expert Prediction

**Paper:** Wang et al., "MoE-SpeQ: Speculative Quantized Decoding with Proactive Expert Prefetching and Offloading for Mixture-of-Experts," arXiv:2511.14102, November 2025.

**Mechanism:** Uses a small, quantized draft model to predict both future tokens and the experts those tokens will activate. A 4-bit quantized Qwen-MoE draft predicts the full-precision model's top-4 experts with 90.9% total fidelity (44.1% hard matches + 46.8% soft matches). Combined with speculative decoding, achieves 2.34x speedup.

**ANE applicability:** MEDIUM. The draft model is substantially larger than a simple router — a quantized draft model is tens to hundreds of MB. However, the ANE *could* run the expert prediction head alone (not the full draft model's token prediction), extracting just the routing information from the draft's hidden states. This separates token speculation (GPU) from expert prediction (ANE).

### 1.5 SP-MoE — SD-Aware Expert Prefetching

**Paper:** "SP-MoE: Speculative Decoding and Prefetching for Accelerating MoE-based Model Inference," arXiv:2510.10302, October 2025.

**Mechanism:** Integrates speculative decoding with expert offloading. During drafting, the draft model's hidden states are used to predict which experts will be needed during verification. Reports 1.07-3.5x TPOT speedup.

**ANE applicability:** MEDIUM. Similar to MoE-SpeQ but with more focus on SD integration. The expert prediction component could be offloaded to ANE.

### 1.6 ProMoE — Activation-Based Expert Caching

**Paper:** "ProMoE: Fast MoE-based LLM Serving using Proactive Caching," arXiv:2410.22134, October 2024.

**Mechanism:** Uses intermediate activations to predict subsequent expert usage and proactively caches/fetches experts. Reports 2.20x prefill and 2.07x decode speedup vs existing offloading.

**ANE applicability:** MEDIUM. The activation analysis could run on ANE, but ProMoE's prediction mechanism is less well-specified than Fate's or the Pre-Attention approach.

### 1.7 MoE-Infinity — Activation-Aware Tracing

**Paper:** "MoE-Infinity: Cost-Efficient MoE Inference via Expert Offloading," arXiv:2401.14361, 2024.

**Mechanism:** Uses historical expert activation traces and per-expert activation statistics for prefetching and caching. Activation-aware, but relies on past patterns rather than per-token prediction.

**ANE applicability:** LOW. The tracing approach is inherently history-based rather than forward-predictive. However, ANE could run activation statistics in the background to update expert importance scores.

### 1.8 Summary Comparison

| Method | Accuracy | Requires Training | Predictor Size | Look-Ahead | ANE Suitability |
|--------|----------|-------------------|----------------|------------|-----------------|
| Fate | 97.15% prefetch | No (reuses router) | Router clone (~1.8M params) | 1 layer | **High** |
| Pre-Attention | 93-97% | Yes (2 linear func) | ~3.7M params | Same layer | **High** |
| Pre-Gated MoE | N/A (arch change) | Yes (retrain model) | Architecture change | 1 layer | Low |
| MoE-SpeQ | 90.9% fidelity | Draft model needed | Full draft model | K tokens | Medium |
| SP-MoE | — | Draft needed | Draft + predictor | K tokens | Medium |
| ProMoE | — | No | Activation analysis | — | Medium |
| MoE-Infinity | — | No | Historical stats | — | Low |

---

## 2. Required Predictor Size

### 2.1 Concrete Size Calculations for DeepSeek V3 Scale

DeepSeek V3: hidden_size=7168, n_experts=256, top_k=8, 58 MoE layers.

| Architecture | Parameters | FP32 | FP16 | INT8 | Fits 1-2 MB? |
|-------------|-----------|------|------|------|---------------|
| Router clone: 7168→256 | 1.8M | 7.00 MB | 3.50 MB | 1.75 MB | **Yes (INT8)** |
| 2-layer MLP: 7168→1024→256 | 7.6M | 29.0 MB | 14.5 MB | 7.25 MB | No |
| 2-layer MLP: 7168→512→256 | 3.8M | 14.5 MB | 7.25 MB | 3.63 MB | No |
| 2-layer MLP: 7168→256→256 | 1.9M | 7.25 MB | 3.63 MB | 1.81 MB | **Yes (INT8)** |
| 2-layer MLP: 7168→128→256 | 0.95M | 3.63 MB | 1.81 MB | 0.91 MB | **Yes** |
| 2-layer MLP: 7168→64→256 | 0.48M | 1.81 MB | 0.91 MB | 0.45 MB | **Yes** |
| Pre-Attn 2-linear | 3.7M | 14.0 MB | 7.00 MB | 3.50 MB | No |

### 2.2 Recommendation

A **2-layer bottleneck MLP (7168→128→256) at INT8 precision** hits the sweet spot:
- **Size:** 0.91 MB — well under the 2 MB budget
- **Capacity:** The bottleneck preserves enough information for expert ranking while being small enough for ANE SRAM
- **Compute:** 950K MACs per prediction, ~25 ns theoretical ANE time, ~150 µs with dispatch overhead
- **Accuracy:** Expected to match or exceed Fate's router-clone approach, since the bottleneck layer can learn cross-layer correlations that a simple router clone cannot capture

For tighter budgets, a 7168→64→256 MLP at 0.45 MB (INT8) or even the direct router clone at 1.75 MB (INT8) are viable alternatives. The Pre-Attention approach's two-linear-function design could be adapted into a single 7168→256 projection trained with ranking-aware loss at 1.75 MB INT8, giving the best accuracy-to-size ratio.

### 2.3 ANE SRAM Constraint

The ANE has ~32 MB SRAM. With predictor model at ~1 MB, there is ample room for:
- Predictor weights (~1 MB)
- Input hidden state (7168 × 2 bytes = 14 KB)
- Output expert logits (256 × 4 bytes = 1 KB)
- Intermediate activations (~1-2 KB for bottleneck)
- ~30 MB remaining for other ANE tasks or double-buffering

---

## 3. How Far Ahead Can Expert Routing Be Predicted?

### 3.1 Prediction Horizons

| Horizon | What You Get | Feasibility | Key Challenge |
|---------|-------------|-------------|---------------|
| **Same layer** (pre-attn) | Prefetch experts for *current* layer | High (>93% accuracy) | Limited lead time: ~0.5-1 ms for attention to mask transfer |
| **1 layer ahead** (Fate) | Prefetch experts for *next* MoE layer | High (97% hit rate with cache) | First MoE layer not predictable; shallow layers harder |
| **2 layers ahead** (cascaded) | Prefetch experts 2 MoE layers ahead | Medium (accuracy drops ~5-10% per layer) | Cascaded error compounds; needs confidence threshold |
| **K tokens ahead** (speculative) | Prefetch experts for future draft tokens | Medium (90-95% fidelity) | Requires draft model; expert choices depend on token identity |

### 3.2 Timing Analysis

For DeepSeek V3 on Apple Silicon:

- **Per-MoE-layer GPU compute time:** ~1-2 ms (attention + top-8 expert FFN)
- **ANE prediction latency:** ~150-200 µs (mostly Core ML dispatch overhead; the 950K MACs compute is ~25 ns)
- **NVMe read bandwidth:** ~6 GB/s on Apple Silicon (unified memory, no double-copy)
- **Expert page size:** 256 KB per page (ADR 0035), ~2 MB for 8 expert FFN blocks

**1-layer-ahead scenario:**
1. GPU starts layer i attention
2. `Gate_in_i` sent to ANE → ~200 µs → predicted experts for layer i+1
3. Prefetch engine has ~1.5 ms (rest of layer i) to pull predicted expert pages from NVMe
4. At 6 GB/s, ~1.5 ms = ~9 MB transferred, more than enough for 8 expert pages (~2 MB)

**Cascaded 2-layer-ahead scenario:**
1. GPU starts layer i attention
2. ANE predicts layer i+1 experts (200 µs)
3. ANE chains: uses predicted experts + Gate_in_i to predict layer i+2 experts (another 200 µs)
4. Prefetch engine now has ~3 ms to pull pages for 2 layers ahead
5. Risk: cascaded prediction error. If layer i+1 prediction is 95% correct, and the cascaded i+2 prediction is 90% correct conditional on i+1 being right, net accuracy ~85%

**Multi-token speculative scenario:**
1. Draft model generates K candidate tokens
2. ANE predicts expert sets for each draft token across all MoE layers
3. During verification, expert pages are already resident
4. Missed tokens fall back to on-demand fetch

### 3.3 Practical Recommendation

Start with **1-layer-ahead prediction** (Fate-style). This is the best-understood, highest-accuracy approach with ample lead time. Cascaded prediction can be added later with a confidence gate: if the layer i+1 prediction confidence (softmax score of predicted top-k) exceeds a threshold, cascade to layer i+2; otherwise, stop at 1 layer.

---

## 4. Required Accuracy for Useful Prefetch

### 4.1 The Accuracy vs. Utility Tradeoff

Expert prediction accuracy interacts with caching to determine the effective prefetch hit rate. The relationship is not linear — a shallow expert cache (holding frequently-accessed experts) absorbs many misses.

**Fate's empirical results** provide the best calibration:
- 97.15% raw prediction accuracy → 99.08% cache hit rate (with shallow-favoring cache)
- Each percentage point of raw accuracy lost costs approximately 0.3-0.5 percentage points of cache hit rate

### 4.2 Accuracy Regimes

| Raw Accuracy | Cache Hit Rate (est.) | Utility | Page Fault Rate | Verdict |
|-------------|----------------------|---------|-----------------|---------|
| <85% | <95% | Marginal | >5% | Too many faults; may be slower than on-demand |
| 85-90% | 95-97% | Acceptable | 3-5% | Useful if miss penalty is low (small pages, fast NVMe) |
| 90-95% | 97-99% | Good | 1-3% | Viable production target |
| 95-97% | 99-99.5% | Excellent | <1% | Fate's reported range; strong net benefit |
| >97% | >99.5% | Near-ideal | <0.5% | As good as fully-resident for practical purposes |

### 4.3 The Critical Insight: Miss Cost Matters

A prediction miss is not a correctness failure — it is a **performance penalty**. The model's output is unchanged; only latency is affected. The miss cost depends on:

- **NVMe latency:** ~50-100 µs on Apple Silicon (very low, unified memory)
- **Page decompression cost:** 0 if using fused dequant matmul (ADR 0035 Pillar 1); ~50-200 µs if decompress-on-load
- **Stall impact:** If 5% of layers have 1 miss each, and each miss adds ~200 µs, total overhead is ~0.6 ms for 58 MoE layers. Compare to ~87 ms total layer time (58 × 1.5 ms). **Overhead: <1%.**

This means even 90% accuracy is net-positive — the 10% miss rate adds negligible overhead compared to the alternative of loading all experts on-demand (which would stall every layer).

### 4.4 Recommended Target

**90% minimum, 95% target, 97% stretch.** The Fate approach achieves 97%+ without training, making this the default baseline. A trained predictor (Pre-Attention style) pushes to 93-97%. The miss penalty on Apple Silicon unified memory is so low that even 90% accuracy is useful, but 95%+ is comfortably in the "strong net benefit" zone.

---

## 5. Interaction with Weight Paging System (ADR 0035)

### 5.1 Direct Integration Points

The expert routing predictor directly feeds ADR 0035's Pillar 2 (Model Virtual Memory) at three integration points:

**A. Residency Tier Promotion**
Predicted experts should be dynamically promoted:
- **MANDATORY:** Router, shared expert, embeddings (always resident — never predicted)
- **HOT:** Predicted routed experts for layer i+1 → promoted from WARM to HOT for the duration of the prediction window
- **WARM:** Non-predicted experts → remain in WARM tier, evicted after use
- **COLD:** Experts not accessed for >N tokens → remain in COLD

The residency contract for predicted experts is **speculative**: pages loaded based on prediction carry a `speculative: true` tag in the page table. On prediction miss, they may be evicted immediately (no LRU credit). On hit, the tag is promoted to `confirmed`.

**B. Prefetch Engine Coordination**
ADR 0035 already defines three prefetch strategies: sequential, router-predicted, and temporal-reuse. The ANE predictor directly drives the **router-predicted** strategy:

```
     ┌─────────────┐     hidden state     ┌──────────────┐
     │   GPU Lane  │ ──────────────────→ │  ANE Predictor│
     │  (layer i)  │                      │  (Core ML)   │
     └──────┬──────┘                      └──────┬───────┘
            │                                    │
            │ attention + FFN                    │ predicted experts
            │ (1.5 ms)                           │ for layer i+1
            │                                    ▼
            │                            ┌──────────────┐
            │                            │  Prefetch    │
            │                            │  Engine      │
            │                            └──────┬───────┘
            │                                    │
            │                                    │ async NVMe read
            │                                    │ + arena reserve
            │                                    ▼
            │                            ┌──────────────┐
            │                            │  Page Table  │
            │                            │  residency   │
            │                            │  promotion   │
            │                            └──────────────┘
            │
            ▼
     ┌─────────────┐
     │   GPU Lane  │ ◄── experts already resident
     │  (layer i+1)│
     └─────────────┘
```

**C. Compressed Block Pre-Decompression**
For WARM-tier experts that are stored compressed (INT4 GroupQuantized), the prefetch engine can initiate decompression (or, with fused dequant, ensure the decompression kernel is loaded and page-table entries are valid) before the GPU lane reaches the layer. The ANE predictor provides the list of expert IDs, enabling:
1. Check page residency for each expert's weight pages
2. If resident: mark page as recently-used (LRU credit)
3. If not resident: issue async NVMe read + schedule decompression
4. If compressed but resident: pre-load decompression metadata into GPU constant memory

### 5.2 Apple Silicon Advantage

On Apple Silicon, there is **no double-copy from disk to GPU**. NVMe reads land directly in unified memory accessible to both the GPU (Metal) and ANE. This means:
- Expert pages read from NVMe are immediately visible to the GPU without additional copies
- The ANE predictor can read hidden states directly from the same unified memory buffer where the GPU writes them
- No PCIe bus contention — the ANE, GPU, and NVMe controller all access the same unified memory over the on-package fabric

### 5.3 Eviction Policy Integration

ADR 0035 defines eviction classes: sticky, disposable, speculative. The predictor adds:

- **Speculative-evict:** Pages loaded based on prediction that turned out wrong get the `speculative` eviction class with penalty = 0. They are evicted before anything with positive LRU credit.
- **Prefetch-downgrade:** If a predicted expert is not used within N layers (prediction was too far ahead), downgrade from HOT to WARM without consuming the page fault budget.
- **Eviction regret receipt:** Track `evicted_expert_used_within_window` — experts that were evicted due to bad prediction but needed shortly after. This feeds back into the predictor's confidence calibration.

### 5.4 Compile-Time Hooks

The compiler can emit **prediction points** into the compute image:
- `PredictGate(layer_idx, input_tensor, output_experts)` — inserted before each MoE layer's attention block
- The compiled image carries the ANE predictor model as a Core ML compiled asset
- At runtime, the lane dispatches `PredictGate` to the ANE prefetch controller while continuing GPU work
- The prefetch controller is a separate execution context that runs in parallel with the main inference lane

---

## 6. Receipt Fields for Verification

The ADR 0034 receipt model is extended with the following fields to verify prediction quality and prefetch effectiveness:

### 6.1 Per-Layer Prediction Receipt

```json
{
  "layer_idx": 15,
  "moE_layer": true,
  "prediction": {
    "predicted_experts": [42, 17, 3, 88, 156, 201, 64, 99],
    "prediction_confidence": [0.92, 0.87, 0.81, 0.76, 0.63, 0.58, 0.44, 0.39],
    "prediction_latency_us": 187,
    "prediction_source": "ane_fate_router_clone",
    "look_ahead_layers": 1
  },
  "verification": {
    "actual_experts": [42, 17, 3, 88, 72, 156, 14, 201],
    "expert_overlap_count": 6,
    "top_k_hit_rate": 0.75,
    "exact_match": false,
    "jaccard_similarity": 0.60
  },
  "prefetch": {
    "pages_prefetched": 8,
    "bytes_prefetched": 2097152,
    "prefetch_initiated_us": 1523456780,
    "prefetch_completed_us": 1523457120,
    "pages_already_resident": 1,
    "pages_faulted": 0,
    "prefetch_hit_rate": 0.875,
    "nvme_read_bytes": 1835008,
    "nvme_read_latency_us": 340
  },
  "timing": {
    "layer_total_us": 1520,
    "gpu_compute_us": 1280,
    "stall_from_miss_us": 0,
    "prefetch_overlap_us": 340,
    "stall_time_avoided_estimate_us": 3200
  }
}
```

### 6.2 Aggregated Session Receipt

```json
{
  "session": {
    "tokens_processed": 4096,
    "moE_layers_with_prediction": 58,
    "total_predictions": 237568
  },
  "prediction_quality": {
    "mean_top_k_hit_rate": 0.96,
    "exact_match_rate": 0.31,
    "mean_jaccard": 0.78,
    "shallow_layer_hit_rate": 0.93,
    "deep_layer_hit_rate": 0.98,
    "prediction_confidence_mean": 0.74
  },
  "prefetch_effectiveness": {
    "pages_prefetched_total": 1900544,
    "bytes_prefetched_total_mb": 486539,
    "pages_faulted_total": 95027,
    "prefetch_hit_rate_overall": 0.95,
    "nvme_read_total_mb": 486539,
    "nvme_read_overlap_percent": 78.3,
    "pages_evicted_speculative": 12341,
    "eviction_regret_count": 87,
    "eviction_regret_rate": 0.00037
  },
  "stall_analysis": {
    "total_stall_from_misses_us": 3801080,
    "total_stall_without_prefetch_est_us": 380108000,
    "stall_avoided_percent": 99.0,
    "mean_ane_prediction_latency_us": 187,
    "total_ane_prediction_time_us": 44415216,
    "ane_overhead_percent": 0.47
  },
  "cache_behavior": {
    "shallow_cache_hit_rate": 0.97,
    "deep_cache_hit_rate": 0.99,
    "hot_tier_occupancy_mean_percent": 72.5,
    "warm_tier_occupancy_mean_percent": 24.8,
    "cold_tier_occupancy_mean_percent": 2.7
  }
}
```

### 6.3 Key Metrics Definitions

| Field | Definition | Target |
|-------|-----------|--------|
| `prefetch_hit_rate` | Fraction of actually-needed experts that were in the predicted+prefetched set | >0.95 |
| `exact_match_rate` | Fraction of predictions where top-k predicted = top-k actual (order-independent) | >0.25 |
| `top_k_hit_rate` | Fraction of actual experts present in predicted set (lenient, k' > k) | >0.95 |
| `stall_avoided_percent` | Estimated % of page fault stall time eliminated vs no prefetch | >90% |
| `ane_overhead_percent` | ANE prediction time as % of total token processing time | <1% |
| `eviction_regret_rate` | Experts evicted due to bad prediction that were needed within window | <0.1% |
| `nvme_read_overlap_percent` | % of NVMe transfer time hidden behind GPU computation | >75% |

### 6.4 Hard-Failure Receipt (for debugging)

If prediction degrades unexpectedly (e.g., >20% absolute drop in hit rate), emit:

```json
{
  "prediction_anomaly": {
    "type": "hit_rate_drop",
    "severity": "warning",
    "expected_hit_rate": 0.96,
    "actual_hit_rate": 0.71,
    "tokens_since_anomaly": 15,
    "likely_cause": "domain_shift",
    "recommended_action": "recalibrate_predictor"
  }
}
```

---

## 7. Recommended Architecture

### 7.1 Tiered Prediction Strategy

```
Tier 1 (Immediate): Fate-style router clone
  - No training required
  - Reuses existing gate weights: Gate_in_i → W_gate → predicted experts
  - 1-layer look-ahead
  - 97%+ accuracy with shallow cache
  - 1.75 MB INT8
  - Implementation effort: ~1 week

Tier 2 (Trained): Pre-Attention lightweight predictor
  - Requires calibration/training on target model
  - Two linear functions with ranking-aware loss
  - Same-layer prediction, more lead time than Fate
  - 93-97% accuracy
  - 3.5 MB INT8 (or 0.9 MB with bottleneck)
  - Implementation effort: ~2-3 weeks

Tier 3 (Advanced): Cascaded multi-layer prediction
  - Chains predictions: i → i+1 → i+2
  - Confidence-gated cascading (stop if confidence drops)
  - Combined with speculative decoding expert prediction
  - Implementation effort: ~3-4 weeks
```

### 7.2 ANE Deployment Model

The predictor is compiled to a Core ML `.mlmodelc` asset at build time, carried in the compute image alongside the weight codec metadata. At runtime:

1. **Initialization:** Core ML loads the predictor model onto the ANE. The predictor stays resident in ANE SRAM for the session duration.
2. **Per-layer invocation:** At each prediction point, the GPU lane writes the hidden state to a pinned unified memory buffer. The ANE reads it, runs the predictor (single Core ML inference call), and writes predicted expert IDs back. The prefetch engine picks up the prediction and issues NVMe reads.
3. **Pipelining:** The ANE works 1 layer ahead of the GPU. While GPU runs layer i, ANE is predicting for layer i+1 based on layer i's gate input.
4. **Fallback:** If Core ML/ANE is unavailable (e.g., older hardware), the predictor falls back to CPU via Accelerate (BLAS). With ~1M MACs, this is ~10-50 µs on M-series CPU — still faster than waiting for on-demand NVMe reads (~350 µs).

### 7.3 Multi-Model Support

The predictor is model-specific (trained on or derived from the target model's gate weights). For multi-model serving:
- Each model's compute image carries its own compiled ANE predictor
- At model switch, load the new predictor onto ANE (~200 µs for 1 MB model load)
- Page table entries carry a `model_id` tag; predictions are scoped to the active model

---

## 8. Risks and Open Questions

1. **Shallow-layer accuracy gap:** Fate reports lower prediction accuracy in early MoE layers. Mitigation: shallow-favoring cache (larger expert cache for early layers). Open question: how well do Pre-Attention predictors perform on shallow layers?

2. **Fine-grained expert MoE:** DBRX-style models with 16-64 small experts per layer may have more predictable routing patterns (smoother distribution) or less predictable ones (more combinations). Testing needed.

3. **Prediction consistency across diverse inputs:** Domain shift (code → prose → math → non-English) may change expert routing patterns. The predictor should emit confidence scores; low-confidence predictions should be discarded (no prefetch) rather than acted on. Receipts should track confidence vs. accuracy correlation to establish a reliable threshold.

4. **Core ML dispatch overhead:** The ANE's 38 TOPS compute is so fast that actual latency is dominated by Core ML dispatch (~50-200 µs). If per-layer dispatch overhead accumulates to >5% of total inference time, consider batching predictions (predict 2-4 layers at once in a single ANE call).

5. **Interaction with KV cache compression (ADR 0035 Pillar 3):** Expert prediction and KV cache management compete for memory bandwidth. During prefill (high throughput), NVMe bandwidth may be saturated by KV cache writes. During decoding (low throughput), there is abundant bandwidth for expert prefetch. The prefetch engine should be bandwidth-aware: throttle prefetch during prefill, accelerate during decoding.

---

## 9. References

1. Fang et al., "Fate: Fast Edge Inference of Mixture-of-Experts Models via Cross-Layer Gate," arXiv:2502.12224, 2025.
2. "Pre-Attention Expert Prediction and Prefetching for Mixture-of-Experts Large Language Models," arXiv:2511.10676, 2025.
3. Microsoft Research, "Pre-gated MoE: An Algorithm-System Co-Design for Fast and Scalable Mixture-of-Expert Inference," ISCA 2024.
4. Wang et al., "MoE-SpeQ: Speculative Quantized Decoding with Proactive Expert Prefetching and Offloading," arXiv:2511.14102, 2025.
5. "SP-MoE: Speculative Decoding and Prefetching for Accelerating MoE-based Model Inference," arXiv:2510.10302, 2025.
6. "ProMoE: Fast MoE-based LLM Serving using Proactive Caching," arXiv:2410.22134, 2024.
7. "MoE-Infinity: Cost-Efficient MoE Inference via Expert Offloading," arXiv:2401.14361, 2024.
8. DeepSeek-AI, "DeepSeek-V3 Technical Report," arXiv:2412.19437, 2024.
9. ADR 0034: Compiled Backend Inference Architecture
10. ADR 0035: Model Virtual Memory and Weight Codec Architecture
