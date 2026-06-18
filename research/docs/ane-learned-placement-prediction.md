# ANE Learned Placement Prediction Research

**Date:** 2026-06-18
**Researcher:** ResearchLearnedPlacement
**Status:** Research Complete — No Code Changes

## Executive Summary

During Tribunus compute-image compilation, Assessment (Layer 0 of ADR 0034) benchmarks backend candidates for each compilation phase to determine which backend (MLX GPU, Core ML ANE, Accelerate CPU, Custom Metal Kernel) wins. Brute-force benchmarking of all candidate placements scales as O(B^N) where B=backends per phase and N=phases — intractable for real models with 50-200+ phases.

A **learned placement predictor** — a small ML model trained on prior assessment runs — can score candidate placements from graph features without running actual hardware benchmarks. This prunes the exponential search space to a small top-K per phase, reducing assessment from minutes/hours to seconds. The predictor itself is small enough (<1 MB at FP16) to run on the ANE during compilation, though CPU dispatch may be faster for single tiny invocations.

## 1. Graph Features That Predict Backend Placement Quality

### Primary Feature Categories

**1a. Op Type Distribution (per phase / fused region)**
The single strongest signal for backend affinity:

| Op type | MLX GPU affinity | Core ML ANE affinity | Accelerate CPU affinity | Notes |
|---|---|---|---|---|
| Dense matmul | High (Metal GEMM) | Medium (as 1x1 conv) | Low | GPU wins at large dims; ANE at stable shapes |
| Attention (QKV proj) | High | Medium-High | Low | GPU for flexibility; ANE for fused stable patterns |
| Conv2D / 1x1 Conv | Medium | **Very High** | Low | ANE is a convolution engine; 1x1 conv lowering is 3x faster on ANE |
| LayerNorm / RMSNorm | Low | Low-Medium | **High** | CPU reductions are deterministic low-latency |
| Softmax | Low | Low | **High** | CPU sampling/normalization |
| GELU / SiLU activation | Medium | Medium | **High** (Accelerate) | vDSP/BLAS on CPU competitive |
| Element-wise ops | Low | Low | **High** | Overhead not worth GPU/ANE |
| RoPE / positional | Low | Low | **High** | CPU deterministic helpers |
| Token embedding lookup | Low | Low | **High** | Small memory, CPU trivial |
| KV cache read/write | Low | Low | Medium | Page residency matters more |

**1b. Tensor Shapes**
- Small tensors (< 1K elements): CPU wins — GPU/ANE dispatch overhead dominates
- Medium tensors (1K–100K): Competitive — shape regularity determines winner
- Large tensors (> 100K): GPU generally wins for matmul; ANE wins for convolution-shaped ops
- Dimension alignment: ANE prefers multiples of 16; misaligned shapes degrade ANE
- Batch dimension: batch=1 heavily penalizes GPU/ANE; batch>=8 amortizes overhead

**1c. Data Types**
- Float32: Only CPU and GPU (ANE prefers FP16/INT8)
- Float16: All backends — ANE's native precision
- INT8: ANE optimized; GPU via Metal; CPU via Accelerate
- BF16: GPU only on M2+ — no ANE support
- Mixed precision phases: may force a specific backend

**1d. Memory Access Patterns**
- Contiguous, coalesced: GPU wins (max bandwidth)
- Strided, scattered: CPU wins (GPU memory divergence hurts)
- Read-heavy: GPU (high bandwidth)
- Write-heavy with reduction: CPU (low latency deterministic)
- IOSurface shared: Prefer backends that share arena pages (no copies)

**1e. Fusion Opportunities (graph topology)**
- Can adjacent ops be fused into one MIL island? → ANE candidate
- Is there a natural Metal kernel fusion boundary? → GPU candidate  
- Can multiple ops be chained into an Accelerate recipe? → CPU candidate
- Inter-op data dependencies: high fan-in/fan-out → GPU (parallelism); sequential chain → CPU/ANE

**1f. Residency / Page Fit**
- Will intermediate tensors fit in ANE's 32 MB SRAM? (SRAM-fit → ANE preferred; overflow → GPU)
- Does the phase read/write MANDATORY pages? (CPU preferred — always resident)
- What is the page lease footprint in unified memory? (minimize copies across backend boundaries)
- Arena page pressure at this point in the schedule? (affects prefetch depth and eviction risk)

### Feature Encoding Approach

Two viable strategies for Tribunus:

**Strategy A: Per-Phase Feature Vector (MLP input)**
~50-80 numeric features aggregated per compilation phase:
- One-hot encoded op type histogram (20-30 ops)
- Tensor shape statistics (min/max/mean dimensions, total elements, alignment to 16)
- Dtype flags (FP32, FP16, INT8, BF16 booleans)
- Memory pattern flags (contiguous, strided, read-heavy, write-heavy)
- Residency flags (MANDATORY page count, SRAM-fit boolean, arena pressure score)
- Graph position features (layer depth, phase index, distance to next/prev backend boundary)

**Strategy B: GNN Graph Embedding (PLACETO-style)**
Graph Neural Network over the full compilation DAG — each phase is a node with features above; edges represent data dependencies. GNN produces per-node embeddings that capture cross-phase relationships. More powerful but larger model. PLACETO demonstrated 6-20x fewer training steps with GNN embeddings vs RNN approaches.

**Recommendation:** Start with Strategy A (simple per-phase feature vector + MLP). If accuracy plateaus, graduate to Strategy B (GNN). The Tribunus compilation graph is smaller than full TF/PyTorch graphs (50-200 nodes vs thousands), so even a flat MLP may suffice.

## 2. Predictor Size: How Small Can It Be?

### Size Analysis

A placement predictor needs to output 3-4 scores per phase (one per backend: MLX GPU, Core ML ANE, Accelerate CPU, Custom Metal Kernel). The score represents predicted latency or a quality ranking.

**Minimal Viable Architecture:**

| Component | Dims | Params (FP16) | Bytes (FP16) | Bytes (INT8) |
|---|---|---|---|---|
| Input features | 64 | — | — | — |
| Hidden layer 1 | 64→128 | 8,320 | 16,640 | 8,320 |
| Hidden layer 2 | 128→64 | 8,256 | 16,512 | 8,256 |
| Hidden layer 3 | 64→32 | 2,080 | 4,160 | 2,080 |
| Output head | 32→4 | 132 | 264 | 132 |
| **Total** | | **~18,788** | **~37.6 KB** | **~18.8 KB** |

Even with generous sizing:

| Component | Dims | Params (FP16) | Bytes (FP16) |
|---|---|---|---|
| Input features | 128 | — | — |
| Hidden layer 1 | 128→256 | 33,024 | 66,048 |
| Hidden layer 2 | 256→256 | 65,792 | 131,584 |
| Hidden layer 3 | 256→128 | 32,896 | 65,792 |
| Hidden layer 4 | 128→64 | 8,256 | 16,512 |
| Output head | 64→4 | 260 | 520 |
| **Total (large)** | | **~140,228** | **~280 KB** |

**Conclusion:** A placement predictor comfortably fits in **50 KB – 300 KB** at FP16, or **25 KB – 150 KB** at INT8. This is dramatically below the 1-2 MB target and an order of magnitude below ANE's 32 MB SRAM budget. The predictor uses <0.1% of ANE SRAM.

### Comparison with Known Systems

- **MLGO inlining model (LLVM):** ~250 KB per decision head, runs inline in the compiler
- **REGAL GNN placement policy:** ~500 KB for graph embeddings + policy network
- **PLACETO:** GNN backbone ~1-2 MB total, but runs as a preprocessing step, not per-phase
- **TASO cost model:** Lightweight analytical model, not learned — but less accurate on diverse hardware

The Tribunus predictor is smaller than all comparable systems because:
1. Only 4 backends (vs 8+ GPU/TPU/CPU combinations in cloud placement)
2. Per-phase, not per-op granularity (fused regions reduce problem size)
3. Apple Silicon has only 3 compute engines (vs heterogeneous clusters)

## 3. Compilation Time Savings

### Current Brute-Force Assessment Cost

For a model with N compilation phases and B backends per phase:
- **Naive brute force:** B^N candidates. For N=100, B=4: 4^100 ≈ 1.6 × 10^60 — impossible.
- **Heuristic (current ADR 0034):** Likely benchmarks all B candidates per phase independently: N × B = 400 benchmark runs.
- **Benchmark cost per candidate:** Each candidate requires: compile backend program → warm up → run inference → measure latency. On Apple Silicon, a single phase benchmark might take 100 ms – 2 seconds depending on:
  - Core ML compilation time (100-500 ms per MIL island)
  - Metal kernel JIT (first run 50-200 ms, subsequent <1 ms)
  - Accelerate warmup (negligible)
- **Total assessment time (current):** 400 candidates × 200 ms avg = **80 seconds** per model. With Core ML compilation dominating, could be **2-5 minutes** for a full model.

### With Learned Predictor

- **Phase 1 (predict):** Predictor scores all B candidates per phase from graph features. No hardware execution. Cost: B × N × predictor_latency.
  - MLP on CPU: ~1 µs per prediction → 400 × 1 µs = 0.4 ms
  - MLP on ANE (batched): ~100 µs for all 400 → 0.1 ms
  - GNN forward pass: ~1-5 ms for full graph → 5 ms
- **Phase 2 (benchmark top-K):** Only benchmark top-K=2 candidates per phase: N × 2 = 200 runs.
  - **Assessment time:** 200 × 200 ms = **40 seconds** (2x reduction from heuristic)
- **Phase 3 (selective verification):** If predictor confidence is high, some phases skip benchmarking entirely (direct placement). If confidence is >0.95 for the top candidate, skip phase.

### Projected Savings

| Strategy | Candidates benchmarked | Assessment time | Reduction |
|---|---|---|---|
| Brute force (theoretical) | 4^100 | astronomical | — |
| Heuristic (benchmark all) | N × B = 400 | ~80 sec – 5 min | Baseline |
| **Learned predictor (top-2)** | **N × 2 = 200** | **~40 sec – 2.5 min** | **2x** |
| **Learned predictor (top-1 + verify)** | **N × 1.2 ≈ 120** | **~24 sec – 1.5 min** | **3-4x** |
| Learned predictor (confident skip) | N × 0.5 ≈ 50 | ~10 sec – 40 sec | 8-10x |

**Best case (warm predictor, high confidence):** Assessment drops from ~2-5 minutes to **10-40 seconds** — a 10x reduction. This matters most during iterative development where assessment re-runs on every code change.

### Real-World Analogues

- **IBM ESP (Early Scenario Pruning):** 80% pruning efficiency, 20% CPU time savings in VLSI physical synthesis — similar concept applied to a different domain.
- **PLACETO:** 6-20x fewer training steps to find optimal placements via learned GNN policy vs RL from scratch.
- **TASO:** Cost-model-guided search prunes graph substitution space by several orders of magnitude.

## 4. Can the Predictor Run on ANE During Compilation?

### Yes, But With Caveats

**Technical feasibility:** The predictor is a small MLP (<300 KB at FP16). Core ML can compile this into a MIL program targeting ANE compute units. The ANE has 32 MB SRAM and 16 cores — a 300 KB program with tiny intermediate tensors fits easily.

**Per-invocation latency:**
- Core ML prediction() fixed dispatch overhead: **~22-27 µs** (independently measured on Apple Silicon)
- ANE compute for a 140K-param MLP: **<1 µs** (the ANE's 5.7 TFLOPS can do ~5.7M multiply-adds in 1 µs; this MLP has only ~140K FLOPs)
- **Total per-invocation:** ~25 µs dominated by Core ML dispatch overhead, not ANE compute

**Problem:** At 25 µs per candidate × 400 candidates = **10 ms total** — this is negligible for compilation. But the problem is that each invocation is a separate `prediction()` call, each incurring the 25 µs overhead independently.

**Better approach — Batching:**
Instead of 400 separate invocations, batch all N phases × B backends into one Core ML call:
- Input: [N×B, feature_dim] tensor
- Output: [N×B, num_backends] score tensor
- Single prediction() call: ~25 µs + negligible ANE time
- **Total predictor cost: ~25-100 µs** (a rounding error in compilation)

**Alternative — CPU predictor:**
- Custom Swift/C with Accelerate/BNNS: **sub-µs** per prediction, no dispatch overhead
- 400 predictions × 1 µs = 0.4 ms total
- Simpler deployment: no Core ML dependency in the compiler toolchain, no ANE resource contention during assessment

**Recommendation:**
- **Phase 1 (development):** Run predictor on CPU via pure Rust/Swift MLP — immediate, no Core ML compilation step, trivially fast.
- **Phase 2 (production):** If predictor grows (e.g., GNN with 2 MB), batch-invoke on ANE to offload — but this is unlikely to be needed given the model's tiny size.
- **Do not invoke ANE per-candidate** — the dispatch overhead defeats the purpose. Always batch.

### ANE-Specific Constraints for the Predictor

- Predictor must use ANE-compatible ops: Linear (as 1x1 conv), ReLU/GELU. No control flow, no dynamic shapes.
- Tensor shapes must be fixed at compile time (they are — features are fixed-dimension).
- Must request `compute_units: .cpuAndNeuralEngine` — Core ML may still place on CPU for such a tiny model.
- ANE compilation is itself slow (~100-500 ms) — this is a one-time cost at compiler startup, not per model.

## 5. How Would the Predictor Be Trained?

### Training Data Source

Every Tribunus assessment run produces labeled data: per phase, per backend candidate, the measured latency. This is the ground truth.

A single model compilation with N=100 phases and B=4 backends produces ~400 labeled examples. After compiling 10 model families across 3 shape variants each, the training corpus reaches:

- 10 families × 3 variants × 100 phases × 4 backends = **12,000 examples**
- With multiple hardware targets (M1, M2, M3, M4): **~50,000 examples**
- With per-layer sensitivity profiling (ADR 0035): **~100,000 examples**

This is sufficient for a supervised MLP with <200K parameters.

### Training Approach

**Supervised regression (recommended):**

1. **Features X:** Per-phase feature vector (64-128 dims) as described in Section 1
2. **Labels Y:** Measured backend latency (µs) for each of the 4 backends
3. **Loss:** Mean Squared Error between predicted and measured latency
4. **Architecture:** 3-4 layer MLP, 64-256 hidden dims, ReLU activation
5. **Training:** Standard SGD/Adam, batch size 128, 100-500 epochs
6. **Validation:** Hold out 20% of models (entire model families, not individual phases — tests cross-model generalization)

**Alternative: Ranking loss**
Instead of predicting absolute latency (which varies by hardware generation), predict the ranking:
- **Loss:** Pairwise ranking loss — for each phase, ensure the true winner is scored higher than losers
- **Advantage:** Invariant to hardware speed; a predictor trained on M1 data generalizes to M4
- **Output:** Per-backend score (not latency); winner = argmax

**Alternative: Classification**
- **Labels:** Which backend won (one-hot over 4 classes)
- **Loss:** Cross-entropy
- **Advantage:** Simplest, most robust
- **Disadvantage:** Loses information about how close the competition was (useful for fallback decisions)

**Recommendation:** Ranking loss + auxiliary regression loss (multi-task). This gives both the winner and a confidence estimate.

### Training Pipeline

```
1. Collect assessment receipts from prior compilations
   → Parse receipt fields: phase_id, backend, observed_latency_us, fallback_reason
   
2. Extract features from compilation IR
   → Per-phase: op histogram, shape stats, dtype, residency flags, graph position
   
3. Label: measured_latency[backend] from receipts
   → Missing (untested backends): impute as INF or mask out
   
4. Train MLP with ranking loss
   → PyTorch training script, ~10 minutes on M-series GPU
   
5. Export to Core ML / ONNX / pure Rust inference
   → For ANE: convert via coremltools, compile to .mlpackage
   → For CPU: export weights as float arrays + simple Rust forward pass
   
6. Validate on held-out model family
   → Check top-1 accuracy (did predictor pick the actual winner?)
   → Check top-2 recall (is actual winner in top 2?)
```

### Cold Start / Bootstrapping

Before any assessment data exists:
1. **Heuristic baseline:** Use hand-crafted rules (ops → GPU, norms → CPU, convolutions → ANE) as initial labels
2. **Synthetic data:** Generate random phase configurations, benchmark a subset, train on those
3. **Transfer from related hardware:** Train on one M-series chip, fine-tune on another
4. **Active learning:** Start with predictor guided by heuristics + uncertainty; as real data accumulates, predictor gradually takes over

### Continuous Improvement

Each new assessment run contributes to the training corpus. The predictor is retrained periodically (every 10-20 compilations) or online (incremental update). The compiled predictor weights are versioned alongside the compiler.

## 6. The Assessment Loop: Predictor + Benchmark + Feedback

### Full Loop Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    COMPUTE-IMAGE COMPILATION                      │
│                                                                   │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐        │
│  │ Model IR │───▶│ Phase        │───▶│ Candidate        │        │
│  │ (graph)  │    │ Decomposition│    │ Generation       │        │
│  └──────────┘    └──────────────┘    └───────┬──────────┘        │
│                                               │                   │
│                    ┌──────────────────────────┘                   │
│                    │ N phases × B backends = N*B candidates       │
│                    ▼                                              │
│  ┌─────────────────────────────────────────┐                     │
│  │        PLACEMENT PREDICTOR               │                     │
│  │  ┌─────────────────────────────────┐    │                     │
│  │  │ Feature Extraction (per phase)  │    │                     │
│  │  │  • Op types, shapes, dtypes     │    │                     │
│  │  │  • Memory access patterns       │    │                     │
│  │  │  • Fusion opportunities         │    │                     │
│  │  │  • Residency / page fit         │    │                     │
│  │  │  • Graph position               │    │                     │
│  │  └────────────┬────────────────────┘    │                     │
│  │               ▼                          │                     │
│  │  ┌─────────────────────────────────┐    │                     │
│  │  │ MLP Forward Pass (batched)      │    │                     │
│  │  │  <300 KB, <100 µs on CPU/ANE    │    │                     │
│  │  └────────────┬────────────────────┘    │                     │
│  │               ▼                          │                     │
│  │  ┌─────────────────────────────────┐    │                     │
│  │  │ Per-backend scores + confidence │    │                     │
│  │  └────────────┬────────────────────┘    │                     │
│  └───────────────┼─────────────────────────┘                     │
│                  │ Top-K per phase (K=2)                          │
│                  ▼                                                │
│  ┌─────────────────────────────────────────┐                     │
│  │        ASSESSMENT BENCHMARK              │                     │
│  │  ┌─────────────────────────────────┐    │                     │
│  │  │ For each phase, benchmark top-K │    │                     │
│  │  │ backends on actual hardware:    │    │                     │
│  │  │  • Compile backend program      │    │                     │
│  │  │  • Warm up, run, measure        │    │                     │
│  │  │  • Record receipts              │    │                     │
│  │  └────────────┬────────────────────┘    │                     │
│  └───────────────┼─────────────────────────┘                     │
│                  │ Measured latencies per candidate               │
│                  ▼                                                │
│  ┌─────────────────────────────────────────┐                     │
│  │        PLACEMENT SELECTION               │                     │
│  │  • Per phase: pick min-latency backend   │                     │
│  │  • Verify prediction accuracy            │                     │
│  │  • Record fallback chains                │                     │
│  │  • Freeze into placement manifest        │                     │
│  └──────────────┬──────────────────────────┘                     │
│                  │                                                │
│  ┌───────────────┼─────────────────────────┐                     │
│  │        FEEDBACK LOOP                     │                     │
│  │  ┌─────────────────────────────────┐    │                     │
│  │  │ Store (features, actual_latency)│    │                     │
│  │  │ per benchmarked candidate       │    │                     │
│  │  └────────────┬────────────────────┘    │                     │
│  │               ▼                          │                     │
│  │  ┌─────────────────────────────────┐    │                     │
│  │  │ Periodically retrain predictor  │    │                     │
│  │  │ on accumulated assessment data  │    │                     │
│  │  └─────────────────────────────────┘    │                     │
│  └─────────────────────────────────────────┘                     │
│                                                                   │
│  ┌──────────────────────────────────────────┐                    │
│  │         COMPUTE IMAGE OUTPUT              │                    │
│  │  • Placement manifest                    │                    │
│  │  • Prequalified kernels                  │                    │
│  │  • Memory layout + page leases           │                    │
│  │  • Receipt specification                 │                    │
│  │  • Prediction accuracy receipt           │                    │
│  └──────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### Detailed Step-by-Step

**Step 0: Predictor Load (once per compiler session)**
- Load compiled predictor weights (Core ML .mlpackage or raw float arrays)
- Optional: compile for ANE if using Core ML path (~500 ms one-time)

**Step 1: Feature Extraction (per model)**
- Walk compilation IR, decompose into phases
- For each phase, compute the feature vector:
  - Op type distribution: count ops by kind, normalize to histogram
  - Shape statistics: min/max/mean/prod of each tensor dim, alignment flags
  - Dtype vector: one-hot over {fp32, fp16, int8, bf16}
  - Memory pattern: contiguous ratio, read/write ratio, strided access flag
  - Residency: MANDATORY page count, estimated SRAM footprint, arena pressure
  - Graph position: layer depth normalized to [0,1], connectivity degree
- Output: feature matrix [N, feature_dim]

**Step 2: Predictor Scoring (per model)**
- If batched on CPU: single matmul chain, <1 ms
- If batched on ANE: single Core ML prediction(), <100 µs
- For each phase: produce score vector [B] where B=4 (MLX, ANE, Accelerate, Custom Metal)
- Sort backends by score descending, take top K=2
- If top-1 confidence > threshold (e.g., 0.95): take K=1 (skip second candidate)
- If top-1 confidence < threshold_min (e.g., 0.5): take K=3 (explore more)

**Step 3: Assessment Benchmarking (per model)**
- For each phase, for each of its K selected backends:
  - Compile backend program (Core ML → MIL island, Metal → kernel, Accelerate → recipe)
  - Allocate arena pages, set up IOSurface if cross-backend
  - Warm up (5-10 iterations)
  - Benchmark (20-100 iterations, record p50/p90/p99)
  - Emit receipt: `{phase_id, backend, compile_us, warmup_us, latency_p50_us, …}`
- Total benchmark time: N × K × (compile + benchmark) per phase

**Step 4: Placement Selection (per model)**
- Per phase: select backend with minimum measured latency
- If top predicted backend ≠ measured winner: log mismatch for feedback
- Build placement manifest: `{phase_id: {primary: backend, fallback: [ordered_list]}}`
- Verify: no phase left without a backend; no illegal fallback chain
- Freeze into compute image

**Step 5: Feedback Collection (ongoing)**
- Append assessment receipts to training corpus
- Track prediction accuracy metrics:
  - Top-1 accuracy: did predictor pick the actual winner?
  - Top-2 recall: was the actual winner in top 2?
  - Mean reciprocal rank of actual winner
  - Calibration: does confidence correlate with correctness?
- If accuracy drops below threshold (new hardware, new model architecture): trigger retraining

**Step 6: Predictor Retraining (periodic)**
- Trigger: every N compilations, or accuracy drift detected
- Merge new assessment data with existing corpus
- Retrain MLP (10 minutes on M-series GPU)
- Validate on held-out models
- If improved: deploy new weights
- If degraded: investigate (distribution shift, new op types, hardware change)

### Receipt Schema for Predictor Feedback

```json
{
  "predictor_version": "v1.2.0",
  "predictor_backend": "cpu_simd",
  "phase_id": "layer_3_attention_qkv_proj",
  "num_backends_scored": 4,
  "predicted_ranking": ["mlx_gpu", "coreml_ane", "accelerate_cpu", "custom_metal"],
  "predicted_scores": [0.87, 0.62, 0.45, 0.31],
  "confidence": 0.87,
  "top_k_selected": 2,
  "benchmarked_backends": ["mlx_gpu", "coreml_ane"],
  "measured_latencies_us": {
    "mlx_gpu": {"p50": 142.3, "p90": 158.1, "p99": 201.7},
    "coreml_ane": {"p50": 189.5, "p90": 210.2, "p99": 245.3}
  },
  "actual_winner": "mlx_gpu",
  "prediction_correct": true,
  "compile_time_saved_ms": 450
}
```

## Integration With Existing ADRs

### ADR 0034 (Compiled Backend Inference Architecture)

The placement predictor **replaces the naive "benchmark all candidates" step** in Layer 0 (Assessment). Instead of benchmarking B candidates per phase, benchmark only top-K. The rest of Layer 0 — defining candidates, running benchmarks, recording receipts — is unchanged.

**New compilation pass:** `predict_placement()` runs after phase decomposition, before assessment benchmarking. It is a pure function of the compilation IR and the trained predictor weights.

### ADR 0035 (Model Virtual Memory / Weight Codec)

Predictor features include **residency information** from ADR 0035's page model:
- Whether a phase reads/writes MANDATORY pages (influences backend choice — CPU preferred for mandatory pages)
- Estimated SRAM footprint of intermediate tensors (influences ANE placement)
- Arena pressure at this schedule point (influences prefetch depth)

The predictor does not replace the knapsack solver for codec assignment (that's a separate optimization). But the predictor could be extended to **predict which codec is best** per weight block (related to ResearchWeightDecompression sibling task).

### Expert Proposal Fabric (ADR 0034)

The ANE expert proposal fabric already describes heterogeneous placement (ANE + CPU + GPU subregions). The placement predictor could extend to **predict the optimal subregion decomposition** — not just which backend, but how to split a phase across backends with IOSurface contracts.

## Risks and Limitations

### Risk 1: Distribution Shift
- **What:** Predictor trained on Llama-family models, applied to DeepSeek MoE architecture → features out of distribution, poor predictions
- **Mitigation:** Per-model-family confidence tracking; if confidence drops, fall back to full benchmarking for that model. Retrain with new family data.

### Risk 2: Overfitting to Hardware Generation
- **What:** Predictor trained on M1 data predicts M4 behavior poorly (different relative backend speeds)
- **Mitigation:** Ranking loss (not absolute latency) helps generalization. Include hardware features (GPU cores, ANE generation, memory bandwidth) as input features.

### Risk 3: Core ML Version Sensitivity
- **What:** Core ML compiler updates change ANE placement behavior → predicted winner no longer matches
- **Mitigation:** Assessment always benchmarks the top-2 candidates — if predicted winner is wrong, the second candidate is still benchmarked and may win. Feedback loop catches drift.

### Risk 4: Predictor Cost Exceeds Savings
- **What:** For very small models (N=10 phases), predictor overhead may exceed benchmark time saved
- **Mitigation:** Skip predictor for models with <20 phases — benchmark all candidates. Worth it only when N × (B - K) × benchmark_cost > predictor_cost.

### Risk 5: ANE Predictor Dispatch Overhead
- **What:** Running predictor on ANE adds Core ML dispatch overhead per compilation
- **Mitigation:** CPU predictor (Rust/Swift SIMD) is trivially fast and avoids ANE dependency. ANE path is optional optimization if predictor model grows.

## Recommendations

1. **Start with CPU predictor.** Pure Rust MLP forward pass, no Core ML dependency, <1 ms per model. Deploy immediately in the assessment pipeline.
2. **Use ranking loss.** Train to predict backend ordering, not absolute latency. More robust to hardware changes.
3. **Collect training data from day one.** Every assessment run (even heuristic "benchmark all") produces labeled data. Store receipts in a structured corpus.
4. **Set K=2 for top-K selection.** Always benchmark top 2 predicted backends — provides safety margin for predictor errors and generates comparison data for retraining.
5. **Track prediction accuracy as a first-class receipt.** Include predictor performance in every compute image receipt.
6. **Retrain periodically, not continuously.** Batch assessment data and retrain every 20-50 compilations. Validate before deploying new weights.
7. **Graduate to GNN only if needed.** The flat per-phase MLP with 128 features and 3 layers should handle 80-90% of placement decisions correctly. If accuracy plateaus below 90%, consider GNN to capture cross-phase dependencies.

## Estimated Effort

| Phase | Work | Timeline |
|---|---|---|
| Feature extraction from compilation IR | Implement per-phase feature computation | 2-3 days |
| Training pipeline | PyTorch script, data loading from receipts, ranking loss | 2-3 days |
| CPU inference | Rust MLP forward pass (matrix multiply + ReLU) | 1 day |
| Integration into assessment | Wire predictor → top-K selection → benchmark | 2-3 days |
| Receipt schema extension | Add predictor fields to assessment receipts | 1 day |
| Training corpus collection | Annotate existing assessment runs | 1-2 days |
| Retraining automation | Trigger, validation, deployment | 2 days |
| ANE deployment (optional) | Core ML conversion, batching, compilation | 2-3 days |
| **Total (CPU path)** | | **9-15 days** |
| **Total (with ANE path)** | | **11-18 days** |

## References

- **PLACETO:** Addanki et al., "Learning Generalizable Device Placement Policies for Distributed Machine Learning Training" — GNN-based iterative placement, 6-20x fewer training steps
- **REGAL:** Paliwal et al., "REGAL: Transfer Learning for Fast Optimization of Computation Graphs" — GNN-based operator scheduling
- **GO:** Zhou et al., "GO: Optimizing Deep Learning Compiler via Graph Neural Network and Proximal Policy Optimization" — GNN + PPO for device placement, fusion, scheduling
- **MLGO:** Trofin et al., "MLGO: Machine Learning Guided Compiler Optimizations Framework" — RL for inlining, register allocation in LLVM; 100-500 KB models
- **TASO:** Jia et al., "TASO: Optimizing Deep Learning Computation with Automatic Generation of Graph Substitutions" — Cost-model-guided graph optimization
- **PROGRAML:** Cummins et al., "PROGRAML: A Graph-based Program Representation for Data-Driven Compiler Optimizations" — GNN on compiler IR
- **ESP:** IBM Research, "Early Scenario Pruning for Efficient Design Space Exploration in Physical Synthesis" — 80% pruning, 20% time savings
- Apple Core ML Performance: Michael's Tinkerings, "Apple M5 GPU Roofline Analysis" — ~22-27 µs Core ML dispatch overhead
- **ADR 0034:** Tribunus Compiled Backend Inference Architecture — Assessment, Compilation, Execution, Receipts
- **ADR 0035:** Tribunus Model Virtual Memory and Weight Codec Architecture — page residency, prefetch, eviction
