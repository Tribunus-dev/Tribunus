# ANE Weight Decompression Policy Research

## Status
Research Report — June 2026

## Purpose

Evaluate whether the Apple Neural Engine (ANE) can serve as a learned decompression policy coprocessor: running a tiny neural network that decides, at page-load time, which weight blocks need higher precision and which can stay at aggressive compression levels. This is analogous to a branch predictor for memory — a speculation fabric that makes quality-vs-memory tradeoffs per block rather than uniformly across the model.

The ANE is a spatial convolution engine with ~32 MB SRAM across 16 cores, accessed through Core ML. It excels at static, shape-stable, graph-like computations — exactly the profile of a tiny classifier or scorer network. Research questions and findings follow.

---

## 1. Known Methods for Learned Per-Block Quantization Policies

### 1.1 Activation-Aware Methods (Not Learned, But Feature-Driven)

**AWQ (Lin et al., MLSys 2024, Best Paper):**
Identifies "salient" weight channels using activation magnitude statistics from a calibration dataset (~128 samples). Channels whose input activations have consistently large magnitudes receive per-channel scaling before quantization to reduce rounding error, rather than being kept at higher precision. This is a per-channel (not per-block) policy, and the scaling factors are computed analytically from activation statistics — not learned via a separate policy network.

**GPTQ (Frantar et al., ICLR 2023):**
Uses the diagonal of the inverse Hessian matrix to determine per-weight sensitivity. Quantizes weights in order of increasing sensitivity, with error compensation applied to remaining unquantized weights. This provides per-weight sensitivity but is a post-hoc correction, not a learned precision-assignment policy.

**SqueezeLLM (Kim et al., 2024):**
Sensitivity-based non-uniform quantization using K-means clustering on weight values. Assigns optimal precision based on parameter sensitivity to error. This is the closest existing method to per-weight-group adaptive precision, but the policy is determined by clustering, not by a separately trained classifier.

### 1.2 Explicitly Learned Policy Methods

**PV-Tuning (Meta, 2025):**
Per-vector tuning: fine-tunes quantization scales via knowledge distillation from the uncompressed model. This is a learned approach but operates at the scale level (continuous optimization), not at the discrete block-level precision assignment level.

**Mixed-Precision Quantization via RL/NAS (various, 2020-2024):**
Several works frame per-layer bitwidth assignment as a reinforcement learning or neural architecture search problem. HAQ (Hardware-Aware Automated Quantization, Wang et al. 2019) uses RL to assign bitwidths per layer, optimizing for accuracy-latency tradeoffs. AutoQ (Lou et al. 2021) uses hierarchical RL for kernel-level bitwidth assignment. These are per-layer, not per-block, and target CNN architectures rather than LLMs.

**SlipQuant/SlipCache (2025):**
Dynamic precision allocation per token position in KV cache, exploiting that early tokens need higher precision than later ones. Demonstrates that per-position (rather than per-weight) precision policies can be learned from activation statistics. The architecture of a positional precision classifier is directly analogous to what we would need for per-block weight precision.

### 1.3 Methods That Eliminate the Need for Per-Block Policies

**QuaRot / SpinQuant (2024-2025):**
Rotation-based methods apply randomized orthogonal transforms (Hadamard) to weights before quantization, making weight distributions uniform. This eliminates the highly non-uniform distribution that creates the need for per-block adaptive precision in the first place. If weights are uniformly distributed after rotation, uniform quantization performs near-optimally without block-level discrimination. This is arguably a cleaner solution but requires fusing the rotation into the preceding operation and may not always be applicable (embedding layers, router layers).

### 1.4 Verdict

**No widely-adopted method exists for learned per-block binary precision assignment in LLM weight compression.** The community has converged on:
- Uniform quantization with per-channel scaling (AWQ) as the pragmatic default
- Per-layer (not per-block) codec assignment during compilation (ADR 0035 Section 8.3)
- Rotation-based methods (QuaRot) to make uniform quantization work well

This is a genuine gap — and one the ANE is well-suited to fill, as a speculation coprocessor running a tiny learned classifier that operates during weight page prefetch.

---

## 2. Features Predicting Weight Block Quality Degradation

Based on the literature, the following features have been shown to correlate with quantization sensitivity at the weight-block level:

### 2.1 Activation Statistics (Primary Signal)

From AWQ and related work:
- **Mean activation magnitude per channel/block**: Channels with high activation magnitude multiply their weight quantization error into the output; these are "salient" and need protection.
- **Activation variance and max value**: Blocks connected to high-variance or outlier-heavy activations degrade more under quantization.
- **Activation distribution shape** (kurtosis, skewness): Heavy-tailed activation distributions concentrate importance in a few channels, creating sensitivity hotspots.

These are computed from a calibration dataset (~128-1024 samples) and are the single strongest predictor of quantization sensitivity.

### 2.2 Block Weight Statistics

- **Block variance and standard deviation**: High-variance blocks have wider value ranges, making uniform quantization grids less efficient (more quantization error per step).
- **Max-min ratio and outlier count**: Blocks containing extreme outlier values (>3-5 sigma from mean) degrade disproportionately. Outliers force the quantization range to widen, wasting precision on the majority of "inlier" values.
- **Block kurtosis / heavy-tailedness**: Leptokurtic (heavy-tailed) weight distributions indicate outlier presence. The kurtosis of the weight distribution within a block is a strong predictor of INT3/INT2 viability.
- **Per-group scale magnitude**: In group-quantized formats (group size 128), blocks with widely varying per-group scales are harder to quantize uniformly.

### 2.3 Second-Order Sensitivity (Strong but Expensive)

- **Hessian diagonal (GPTQ)**: The diagonal of the inverse Hessian of the layer output with respect to weights is the gold-standard sensitivity metric. Blocks containing weights with large Hessian values cause more output perturbation when quantized. However, computing the full Hessian is O(d_col³) per layer — hours of calibration for large models.
- **Fisher information approximation**: Diagonal Fisher information (empirical Fisher from calibration gradients) is cheaper than the full Hessian and correlates strongly with quantization sensitivity.

### 2.4 Layer and Position Features

- **Layer depth/index in the transformer stack**: Early layers are more sensitive to quantization (AsymKV, SmoothQuant findings). Attention layers are 3-5x more sensitive than FFN layers (ADR 0035 Section 8.3).
- **Block position within layer** (Q, K, V, O projections; gate, up, down in FFN): Different projection types have characteristically different weight distributions.
- **Preceding operation type**: Blocks following LayerNorm vs. blocks following ReLU/GELU have different activation patterns affecting downstream weight sensitivity.

### 2.5 MoE-Specific Features

- **Expert identity and routing frequency**: Frequently-routed ("hot") experts see more diverse activation patterns and need more conservative quantization. Cold experts that are rarely or never activated can be compressed more aggressively.
- **Expert cluster membership**: In DeepSeek-style shared+routed architectures, the shared expert sees all tokens and needs higher precision. Routed experts within the same cluster may have similar sensitivity profiles.
- **Router gate logits**: The router's output distribution (which tokens go to which experts) can be a feature for predicting expert importance.

### 2.6 Cluster Membership (SqueezeLLM Insight)

SqueezeLLM demonstrates that weights naturally cluster (via K-means) and that cluster boundaries correspond to quantization sensitivity boundaries. Blocks assigned to "outlier clusters" (clusters with extreme centroids) degrade more under quantization. Cluster membership is a cheap proxy for full Hessian analysis.

### 2.7 Recommended Feature Set for ANE Policy

For a practical ANE policy network targeting <1 MB:

| Feature | Dim | Source | Cost |
|---------|-----|--------|------|
| Per-block weight variance | 1 | Static (compressed image metadata) | Free |
| Per-block max-min ratio | 1 | Static | Free |
| Per-block outlier count (abs > 3σ) | 1 | Static (computed at encoding) | Free |
| Per-block kurtosis | 1 | Static | Free |
| Mean activation magnitude (from calibration) | 1 | Calibration data, per layer | One-time |
| Layer depth (normalized 0-1) | 1 | Model topology | Free |
| Block type (Q/K/V/O/gate/up/down) | 6 (one-hot) | Model topology | Free |
| Expert routing frequency (MoE) | 1 | Router statistics | Free |
| Cluster membership ID | 1 | K-means on weight values | One-time |
| Per-group scale variance | 1 | Static | Free |
| **Total feature vector** | **~15 floats** | | |

This is a tiny input — a 15-dimensional feature vector per block — making the policy classifier trivially small.

---

## 3. ANE Program Size Feasibility (< 1 MB)

### 3.1 ANE Model Size Constraints

Apple recommends models under 10 MB for optimal Neural Engine efficiency (Core ML documentation). The ANE has:
- Maximum tensor dimension: 16,384
- Maximum model block size: 1,024
- ~32 MB SRAM shared across 16 cores
- Optimized for FP16 and INT8 compute

For a policy classifier, we are operating far below these limits.

### 3.2 Core ML Model Size Reality

From the Core ML size guide and quantization documentation:

| Precision | 100 KB model | 500 KB model | 1 MB model |
|-----------|-------------|-------------|-----------|
| FP32 (4 bytes/param) | ~25k params | ~125k params | ~250k params |
| FP16 (2 bytes/param) | ~50k params | ~250k params | ~500k params |
| INT8 (1 byte/param) | ~100k params | ~500k params | ~1M params |

These figures include Core ML metadata overhead (~10-20% of file size). A tiny MLP classifier can easily fit in 50-200 KB.

### 3.3 Architecture Candidates

**Option A: Binary MLP Classifier (Recommended)**

```text
Input: ~15 features per block (see Section 2.7)
Hidden: 64 units (ReLU)
Hidden: 32 units (ReLU)
Output: 1 unit (sigmoid) → probability block needs high precision

Total: ~3,200 parameters
At FP16: ~6.4 KB weights + Core ML overhead ≈ 15-25 KB .mlmodel
ANE execution: < 5 microseconds per block batch
```

This is a standard binary classifier. With 64 and 32 hidden units, it has enough capacity to learn non-linear interactions between features (e.g., high variance + early layer = extra sensitive) without overfitting.

**Option B: Small CNN (if spatial structure matters)**

If blocks have spatial relationships (adjacent blocks in the same weight matrix tend to have similar sensitivity), a 1D CNN could exploit this:

```text
Input: 15 features × 8 adjacent blocks (sliding window)
Conv1D: 3×15→32
Conv1D: 3×32→16
Dense: 16×8→1 (sigmoid)

Total: ~2,000 parameters
At FP16: ~4 KB weights
```

However, the spatial correlation benefit is unproven and adds complexity. The MLP is the safer starting point.

**Option C: K-Means + Table Lookup (Not Neural)**

For comparison, a non-neural approach: cluster blocks into K groups based on feature vectors, then use a table mapping each cluster to a precision level (learned from calibration quality measurements).

```text
K = 16-64 clusters
Table: 16-64 entries × 2 bytes (precision level) = 32-128 bytes
No ANE needed — just a table lookup
```

This is the true "boring" baseline. If it works, the ANE is unnecessary. However, K-means cannot model non-linear feature interactions (e.g., "high variance AND early layer AND attention projection = very sensitive"), which a neural classifier can.

### 3.4 Verdict

**A policy network fits comfortably in 20-100 KB** (< 0.1 MB), well within the < 1 MB target. This is 100-500× smaller than Apple's 10 MB recommendation for ANE efficiency. The ANE can execute this classifier in microseconds.

Core ML export path: PyTorch → `coremltools.convert()` → `.mlmodel` or `.mlpackage` → request ANE compute units. The compiler's assessment phase verifies actual ANE placement.

---

## 4. Memory Savings from Selective Decompression

### 4.1 The 80/20 Hypothesis

The core premise: ~20% of weight blocks degrade quality at low precision and need higher precision; the remaining ~80% can be aggressively compressed. What are the actual memory savings?

### 4.2 Bitwidth Arithmetic

Let `p` = fraction of blocks at high precision, `b_high` = bits per weight for critical blocks, `b_low` = bits per weight for non-critical blocks.

Effective bits per weight = `p × b_high + (1-p) × b_low`

Overhead: each block needs a 1-bit "precision flag" stored in the page table (negligible at 64 KB page size — 1 bit per 64 KB = 0.0002% overhead).

### 4.3 Scenario Analysis

**Conservative scenario (today's technology):**
- 20% critical blocks: INT8 (8 bpw)
- 80% non-critical: INT4 group-quantized (4.25 bpw including fp16 scales)
- Effective: 0.2 × 8 + 0.8 × 4.25 = **5.0 bpw**
- vs uniform INT4: 4.25 bpw → selective decompression is 17.6% LARGER
- **Not a win** — you need more aggressive compression of the 80% for this to pay off.

**Aggressive scenario (codebook methods):**
- 20% critical blocks: INT8 (8 bpw)
- 80% non-critical: 2-bit codebook (AQLM-style, 2.0 bpw)
- Effective: 0.2 × 8 + 0.8 × 2.0 = **3.2 bpw**
- vs uniform INT4: 4.25 bpw → **24.7% smaller**
- **Substantial win** but requires codebook kernels (deferred in ADR 0035).

**Balanced scenario (pragmatic target):**
- 20% critical blocks: INT4 group-quantized (4.25 bpw)
- 80% non-critical: 3-bit group-quantized (3.25 bpw including scales)
- Effective: 0.2 × 4.25 + 0.8 × 3.25 = **3.45 bpw**
- vs uniform INT4: 4.25 bpw → **18.8% smaller**
- Uses existing GroupQuantized codec (just different bitwidth per page).

### 4.4 Concrete Memory Savings by Model Scale

| Model | Params | Uniform INT4 | Selective (20% INT4, 80% INT3) | Savings |
|-------|--------|-------------|-------------------------------|---------|
| GPT-OSS 20B | 20B | ~10.6 GB | ~8.6 GB | **2.0 GB** |
| GPT-OSS 120B | 120B | ~63.8 GB | ~51.8 GB | **12.0 GB** |
| DeepSeek V3 671B | 671B | ~356 GB | ~289 GB | **67 GB** |
| DeepSeek V4-Pro 1.6T | 1,600B | ~850 GB | ~690 GB | **160 GB** |

For the DeepSeek V4-Pro at 1.6T parameters, saving 160 GB is ~19% of the compressed model. On an M3 Ultra with 512 GB unified memory, this could be the difference between fitting entirely in RAM vs. requiring expert paging to NVMe.

### 4.5 MoE-Specific Savings

MoE models amplify the savings because:
- Cold experts (80%+ of experts, receiving <5% of tokens) can be at 2-3 bit without quality loss
- Hot experts (top ~20%) need INT4 or better
- Router layers and shared experts need INT8 or FP16

For DeepSeek V3 with 256 experts (8 active per token):
- Shared expert + router: ~2% of weights → MANDATORY, INT8/FP16
- Hot routed experts (frequently selected): ~15% of expert weights → INT4
- Cold routed experts (rarely selected): ~83% of expert weights → 2-3 bit codebook
- Effective expert weight bitwidth: much lower than uniform INT4

### 4.6 Area Under the Curve

The actual memory-quality Pareto frontier depends on the policy's discrimination quality. A random policy (50/50 assignment) provides no benefit. The value of the ANE policy is in its discrimination accuracy — how well it identifies the 20% of blocks that actually need protection.

From AWQ/SpQR findings: ~1% of weights (outliers) cause ~75% of quantization error at 3-4 bit. This suggests the distribution is even more skewed than 80/20 — a very small fraction of blocks may need protection, and the "long tail" of blocks are highly compressible.

---

## 5. Integration with the WeightCodec System (ADR 0035)

### 5.1 Current WeightCodec Architecture

ADR 0035 defines a `WeightCodec` enum with four variants:
- **Identity**: fp16/bf16, no compression
- **GroupQuantized**: INT4 or INT8, group size 128, AWQ scaling
- **RotationQuantized**: QuaRot/SpinQuant rotation + group quantization
- **CodebookQuantized**: AQLM-style additive codebook (deferred)

Every weight page (64 KB for dense, 256 KB for expert FFN) carries: `page_id`, `dtype`, `layout`, `checksum`, `residency_tier`, `backend_compatibility`, `load_cost`, `predicted_next_use`.

Codec assignment happens at compile time: the compiler's assessment phase runs a knapsack solver that assigns codecs per layer to maximize quality given a memory budget.

### 5.2 Two Integration Approaches

**Approach A: New Codec Variant (Integrated)**

Add a new `WeightCodec::AdaptiveGroupQuantized` variant where each page within the layer can have a different bitwidth. The page header gains a `precision_bits` field (2 bits: 2, 3, 4, or 8 bit). The policy runs at compile time, assigning precision per page based on calibration statistics. The runtime simply reads the page header and selects the appropriate dequant kernel.

Pros: Simple runtime — no dynamic decisions. Cons: Static policy — no adaptation to runtime activation patterns, no MoE routing feedback.

**Approach B: Page-Manager Policy Hook (Decoupled, Recommended)**

The ANE policy runs as a **prefetch-time decision engine**, not a compile-time classifier. This is analogous to a branch predictor:

1. During prefetch, before loading a weight page, the page manager submits a batch of page feature vectors to the ANE
2. The ANE runs the policy network and returns per-page precision decisions
3. The page manager writes precision overrides into the page table
4. When the page is actually loaded, the decompression engine reads the precision tag and decompresses accordingly
5. The policy can be updated (delta-compiled) without re-encoding the entire model

This approach has several advantages:
- **Runtime-adaptive**: The policy can incorporate runtime signals (actual activation statistics, router gate distributions, token batch characteristics) that were not available at compile time
- **Decoupled lifecycle**: The policy model (.mlmodel) is a separate artifact from the weight codec. Policy updates don't require re-quantizing the model.
- **Receipt-verifiable**: The policy decision is recorded in receipts — "page X loaded at INT3 per policy score 0.12"
- **Graceful degradation**: If the ANE is unavailable or the policy errors, fall back to the compile-time codec assignment

### 5.3 Page Table Extension

Each page table entry (currently ~64 bytes per ADR 0035) gains:

```text
precision_override: u2    // 0=use compile-time default, 1=2-bit, 2=3-bit, 3=4-bit, etc.
policy_score: f16          // ANE policy output score (for receipts/debugging)
policy_version: u16        // which policy model produced this decision
```

The page table overhead is minimal: 4 additional bytes per page. For 5.2M pages (DeepSeek V3 at 64 KB pages), this adds ~21 MB — negligible against 335 GB of model weights.

### 5.4 Data Flow

```text
Compile time:
  1. Encode weights at multiple precision levels (2-bit, 3-bit, 4-bit, 8-bit)
  2. Extract per-block feature vectors (variance, kurtosis, activation stats, etc.)
  3. Store all precision variants in the compressed weight image
  4. Store feature vectors in a sidecar table (~15 floats × number of pages)
  5. Compile and embed the ANE policy model

Runtime (per token, during prefetch):
  1. Page manager identifies candidate pages for prefetch (sequential + router-predicted)
  2. For each candidate page, look up feature vector from sidecar table
  3. Batch feature vectors → submit to ANE policy network
  4. ANE returns per-page precision decisions (scores)
  5. Page manager writes precision_override into page table
  6. Async load pages from disk at the decided precision level
  7. Dequantize at the decided precision during fused matmul
```

### 5.5 Storage Implications

Storing all precision variants is the main cost. However:
- For MoE models with 256 experts, cold experts are almost always loaded at the lowest precision — we can store only the low-precision variant and not waste space on the high-precision variant for cold blocks
- The policy's discrimination quality determines how much redundant storage we need
- For 80% of blocks that are "certainly low precision" (policy score < 0.1), store only the low-precision variant
- For the ~20% of blocks in the "maybe" zone, store both variants
- This selective multi-encoding reduces multi-precision storage overhead from ~2x to ~1.3x

---

## 6. Latency Overhead vs. Uniform Quantization

### 6.1 Where the Policy Runs

The policy runs during **weight prefetch**, not during the critical decode path. Prefetch is already happening asynchronously (sequential lookahead, router-predicted expert loading). The policy adds a small synchronous decision step before the async load begins.

### 6.2 Latency Budget

**ANE policy inference (per batch of ~16-64 pages):**
- Feature extraction: ~0 (pre-computed at compile time; table lookup)
- ANE model execution: ~10-50 microseconds for a 3,200-parameter MLP
- Decision write-back to page table: ~100 nanoseconds (unified memory, no copy)
- **Total policy overhead per batch: ~10-50 microseconds**

**Context for comparison:**
- Per-token decode latency (LLM): 10-50 milliseconds for 7B model, 50-200ms for 70B+
- Prefetch NVMe read latency: ~50-100 microseconds (4 KB page), ~500 microseconds (64 KB page)
- Page fault handling: ~100-500 microseconds (NVMe read + decompress)
- GPU kernel launch overhead: ~5-30 microseconds
- ANE region boundary cost: ~30-80 nanoseconds (ADR 0034)

**Policy overhead as fraction of decode time: 0.02-0.5%** — effectively in the noise.

### 6.3 Throughput Impact Analysis

The key tradeoff is not policy latency vs. no-policy latency. It's:

**Policy ON:** Slightly higher prefetch latency (+10-50 microseconds) but pages are loaded at optimal precision → less memory bandwidth consumed → faster matmul → higher throughput.

**Policy OFF (uniform):** Zero policy latency, but all blocks use the same conservative precision → more memory bandwidth consumed → slower matmul.

On Apple Silicon with unified memory, inference is **memory-bandwidth-bound** during decode (token generation). The M2 Ultra has 800 GB/s memory bandwidth. A 70B model at 4-bit requires reading ~35 GB of weights per forward pass. At 800 GB/s, weight loading alone takes ~44ms per token.

If selective decompression reduces weight traffic by 19% (3.45 bpw vs 4.25 bpw), weight loading drops to ~36ms — saving 8ms per token. The policy cost of 10-50 microseconds is **paid back 160-800x per token**.

### 6.4 ANE Concurrency

A critical architectural consideration: the ANE runs concurrently with the GPU. While the GPU is executing the current token's matmul, the ANE can be running the policy for the next token's prefetch. This is zero-overhead pipelining:

```text
Token N:   GPU matmul (using precision decisions from Token N-1's policy)
           ANE: policy inference for Token N+1's pages
Token N+1: GPU matmul (using precision decisions from Token N's policy)
           ANE: policy inference for Token N+2's pages
```

If the ANE policy takes <1ms and GPU matmul takes 10-200ms, the ANE has 9-199ms of idle time between policy runs — more than enough headroom. The policy is effectively **free** in throughput terms.

### 6.5 Compile-Time vs. Runtime Policy

A compile-time static policy (Approach A from Section 5.2) has zero runtime latency but cannot adapt to:
- Actual activation distributions at inference time (different from calibration data)
- MoE routing patterns (which experts are "hot" for the current input)
- Batch-size-dependent precision needs (larger batches may tolerate lower precision)

A runtime ANE policy (Approach B) adds the 10-50 microsecond cost but enables adaptation. For most workloads, the adaptation benefit (better quality at same memory, or same quality at lower memory) outweighs the microsecond-level overhead.

### 6.6 Worst-Case Analysis

If the ANE is unavailable (policy model doesn't compile for ANE, falls back to CPU/GPU), the policy cost increases to ~50-200 microseconds (CPU MLP inference or GPU kernel launch). This is still <0.5% of per-token latency and remains net-positive.

If the policy model itself fails (ANE error, model corruption), the page manager falls back to the compile-time codec assignment — uniform quantization at the conservative precision level. The system degrades gracefully to existing ADR 0035 behavior.

---

## 7. Architecture Recommendation

### 7.1 Policy Architecture

```text
Component: ANEWeightPolicy
Type: Core ML .mlmodel, FP16 precision, < 100 KB
Input: 15-dimensional feature vector per weight page
Output: Scalar score [0, 1] = probability that this block needs high precision
Architecture: 15 → 64 (ReLU) → 32 (ReLU) → 1 (sigmoid)
Training: Binary classification on calibration data
  - Positive examples: blocks where INT3 quant causes >0.1 perplexity degradation
  - Negative examples: blocks where INT3 is fine
  - Labels generated by per-block quantization ablation during assessment
Lifecycle: Compiled once per model, updateable via delta compilation (~500ms)
```

### 7.2 Integration Points

1. **Compile-time (assessment phase):** Train policy on calibration data. Generate block feature vectors and multi-precision weight encodings. Embed policy model and feature table in compute image.

2. **Prefetch-time (execution phase):** Page manager batches upcoming pages, submits feature vectors to ANE, receives precision decisions, overrides page table precision tags.

3. **Decompress-time (execution phase):** Fused dequantize-matmul reads precision tag from page table, selects appropriate kernel variant.

4. **Receipt-time:** Record policy decisions and scores per page for offline quality analysis and policy refinement.

### 7.3 Integration with WeightCodec

The `WeightCodec` enum gains an optional `adaptive_policy` field:

```rust
enum WeightCodec {
    Identity,
    GroupQuantized { bits: u8, group_size: u16, adaptive_policy: Option<PolicyId> },
    RotationQuantized { .. },
    CodebookQuantized { .. },
}
```

When `adaptive_policy` is `Some(id)`, the GroupQuantized codec stores multiple bitwidth variants per page and relies on the ANE policy to select at prefetch time. When `None`, the codec uses uniform precision (existing behavior).

### 7.4 Phased Rollout

**Phase 1 (research):** Train policy offline on calibration data. Measure discrimination accuracy (ROC-AUC of block criticality prediction). Validate that the 15-feature MLP achieves >85% accuracy in identifying quality-degrading blocks.

**Phase 2 (integration):** Implement page table precision override fields. Implement multi-precision encoding for GroupQuantized codec. Implement compile-time policy training pipeline.

**Phase 3 (runtime):** Implement ANE policy inference during prefetch. Implement graceful fallback to compile-time codec. Add policy-related receipt fields.

**Phase 4 (optimization):** Profile and tune batch size, feature set, and model architecture. Evaluate MoE-specific policy variants (per-expert features). Measure end-to-end throughput improvement.

---

## 8. Open Questions and Risks

1. **Discrimination difficulty:** Can a 15-feature MLP actually predict which blocks degrade at low precision? The AWQ/SpQR literature suggests yes (activation magnitude alone is highly predictive), but per-block (vs. per-channel) discrimination needs empirical validation.

2. **Multi-precision storage overhead:** Storing 2-3 precision variants per block increases compressed model size by 30-100%. This overhead must be amortized by the runtime memory bandwidth savings. For models that already fit in RAM, there is no net benefit.

3. **ANE availability:** The ANE is only available on Apple Silicon. On AMD/NVIDIA/Intel, the policy falls back to CPU or GPU — still fast but not zero-cost. This cross-platform discrepancy could complicate the compiler's assessment phase.

4. **Policy staleness:** If the model is fine-tuned, the compile-time feature vectors may become stale. The policy itself may need retraining. Delta compilation (500ms weight update) helps but doesn't retrain the policy.

5. **Rotation as alternative:** QuaRot/SpinQuant achieves near-uniform weight distributions without per-block policies. If rotation works well on Metal (Hadamard transform on GPU), it may be a simpler solution than ANE-based adaptive precision.

6. **Measurement methodology:** Quantifying the quality-memory tradeoff requires standardized benchmarks (perplexity on held-out data, downstream task accuracy). Without this, we cannot optimize the policy threshold or compare against uniform baselines.

---

## References

- Lin et al., "AWQ: Activation-aware Weight Quantization," MLSys 2024
- Frantar et al., "GPTQ: Accurate Post-Training Quantization," ICLR 2023
- Dettmers et al., "SpQR: A Sparse-Quantized Representation," 2023
- Kim et al., "SqueezeLLM: Dense-and-Sparse Decomposition," 2024
- Chee et al., "QuIP: 2-Bit Quantization With Guarantees," NeurIPS 2023
- Tseng et al., "QuIP#: Hadamard Incoherence and Lattice Codebooks," 2024
- Egiazarian et al., "AQLM: Extreme Compression via Additive Quantization," ICML 2024
- Wang et al., "HAQ: Hardware-Aware Automated Quantization," CVPR 2019
- ADR 0034: Compiled Backend Inference Architecture
- ADR 0035: Model Virtual Memory and Weight Codec Architecture
- ADR 0035: Weight Quantization Codec Research
- Apple Core ML Documentation: Reducing the Size of Your Core ML App
- Apple Core ML Tools: Quantization Guide
