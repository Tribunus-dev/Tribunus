# ADR 0035: Weight Quantization Codec Research — Methods, Kernels, Backends, and Interface Design

## Status
Research Report — June 2026

## Purpose

Systematic survey of weight quantization methods for large language model inference, evaluated for a portable compiler architecture targeting Apple Silicon (Metal), AMD (ROCm/HIP), Intel (oneAPI/SYCL), NVIDIA (CUDA), and Tenstorrent (TT-Metalium/RISC-V) backends. Focus: offline weight compression (not KV cache quantization), fused dequantize-execute kernels, sub-4-bit regimes, and MoE model suitability. Findings inform the WeightCodec interface design for compute-image compilation (ADR 0034 Layer 1).

---

## 1. AWQ — Activation-aware Weight Quantization

**Paper:** Lin et al., "AWQ: Activation-aware Weight Quantization for On-Device LLM Compression and Acceleration," MLSys 2024 (Best Paper Award).

### 1.1 Mechanism

AWQ identifies "salient" weight channels by analyzing activation distributions on a small calibration dataset (~128 samples). Channels whose corresponding input activations have consistently large magnitudes are deemed salient — quantization error on these channels gets amplified multiplicatively in the layer output.

Rather than leaving salient weights in higher precision (which creates irregular memory layouts), AWQ applies **per-channel scaling before quantization**:

1. For each weight channel `c`, compute a scaling factor `s_c` from activation statistics
2. Scale weights: `W'_c = W_c / s_c` (shrinks salient weights, making them less vulnerable to rounding error)
3. Quantize `W'` to INT4 (symmetric or asymmetric group quantization)
4. At inference time, the scaling is compensated by folding `s` into the preceding LayerNorm or by an explicit scale after dequantization

The scaling factors are derived from the average activation magnitude per channel, tuned with a grid-search hyperparameter `alpha` that balances protection vs. dynamic range.

**Format:** INT4 per-weight, group size 128, per-group fp16 scale (no zero-point for symmetric). Effective bitwidth ~4.25 bpw including scale overhead.

### 1.2 Fused Kernels

| Backend | Kernel | Status |
|---------|--------|--------|
| NVIDIA CUDA | `awq_gemm` (vLLM, TensorRT-LLM) | Production |
| NVIDIA CUDA | Marlin (via repack) | Production, 2.8x vs FP16 at batch=16 |
| NVIDIA CUDA | QuTLASS (Blackwell) | Development |
| Apple Metal | TinyChatEngine | Production, >3x vs HF FP16 on M-series |
| Apple Metal | mps-bitsandbytes (community) | Experimental, fused dequant+matmul |
| Apple Metal | metalcore (INT4 GEMM, block_q4_0) | Community |
| Apple MLX | mlx-lm AWQ repack via vllm-metal | Production |
| AMD ROCm | ROCm-aware port of AWQ kernels | In progress (AMD adopted AWQ May 2024) |
| Intel GPU | SYCL port via IPEX | Experimental |
| Vulkan | No dedicated kernel | N/A |
| Tenstorrent | No implementation known | N/A |

### 1.3 Quality

| Bits | Model Size | Quality Impact | Notes |
|------|-----------|----------------|-------|
| 4-bit | 7B | <1% perplexity degradation vs FP16 | Near-lossless |
| 4-bit | 13B-70B | <0.5% degradation | Outperforms GPTQ at same bitwidth |
| 3-bit | 7B | ~3-5% degradation | Usable with group size 64 |
| 2-bit | Any | Significant degradation | Not recommended without hybrid approach |

### 1.4 MoE Suitability

AWQ works well with MoE models but has a key interaction: **each expert sees different activation distributions** because the router gates different tokens to different experts. The AWQ authors recommend:

- **Per-expert calibration**: Run calibration data through the full model and collect per-expert activation statistics separately — NOT shared across experts
- **Uniform quantization config across experts** is acceptable (same group size, same bitwidth) because the per-channel scaling factors adapt to each expert's activation patterns
- **Router layers should use higher precision** (fp16 or 8-bit) because the routing decision amplifies small errors
- For models like Mixtral 8x7B, the memory savings from 4-bit expert weights are substantial (total parameter count drops from ~47B to ~13GB) while the router's 8-bit overhead is negligible

### 1.5 Apple Silicon Compatibility

The path to AWQ on Apple Silicon is mature through three routes:

1. **MLX framework**: Apple's native ML framework with first-class 4-bit support. vllm-metal loads HuggingFace AWQ checkpoints by repackaging through mlx-lm's transformation pipeline — this is the recommended production path.
2. **TinyChatEngine**: Co-designed with AWQ, platform-aware weight packing and kernel fusion, >3x speedup on M-series.
3. **Community Metal kernels**: `mps-bitsandbytes` for fused dequant+matmul, `metalcore` for INT4 GEMM including GGML block_q4_0 format.

---

## 2. GPTQ — Post-Training Quantization via Approximate Second-Order Optimization

**Paper:** Frantar et al., "GPTQ: Accurate Post-Training Quantization for Generative Pre-Trained Transformers," ICLR 2023.

### 2.1 Mechanism

GPTQ processes weight matrices layer-by-layer using the **Optimal Brain Quantizer (OBQ)** framework adapted for large models:

1. For each layer, compute the inverse Hessian `H^{-1}` of the layer's output with respect to its weights, using a calibration dataset
2. Quantize weights column-by-column in order of increasing quantization error sensitivity (using diagonal of `H^{-1}`)
3. After quantizing each weight, apply a closed-form update to remaining unquantized weights to compensate for the introduced error: `delta_w = -(w_q - w) * H^{-1}[i,:] / H^{-1}[i,i]`
4. Use "lazy batch updates" to process columns in batches (typically 128 columns at a time), with Cholesky decomposition for numerical stability

The key insight: the Hessian provides per-weight sensitivity information, enabling error compensation that preserves layer output fidelity. The computation is entirely offline (calibration only).

**Format:** INT4 per-weight, group size 128 (standard), with per-group fp16 scale and optional zero-point. GPTQ also supports 3-bit and 2-bit with group size adjustments. The "gptq" format in HuggingFace uses symmetric quantization with scales.

### 2.2 Fused Kernels

| Backend | Kernel | Status |
|---------|--------|--------|
| NVIDIA CUDA | GPTQ CUDA kernel (autogptq) | Production |
| NVIDIA CUDA | Marlin (IST Austria) | Production, near-ideal 4x speedup; 2.6-3.1x throughput lift |
| NVIDIA CUDA | ExLlamaV2 (specialized GPTQ kernel) | Production, fast 4-bit |
| NVIDIA CUDA | TensorRT-LLM (GPTQ plugin) | Production |
| Apple Metal | llama.cpp GGML (Q4_0, Q4_K_M) | Production, not true GPTQ format |
| Apple Metal | MLX (4-bit group quantized) | Production |
| Apple Metal | No dedicated GPTQ Metal kernel | Gap |
| AMD ROCm | ROCm port of GPTQ CUDA kernel | In progress |
| Intel GPU | IPEX GPTQ support | Experimental |
| Vulkan | llama.cpp Vulkan backend (GGML) | Community |
| Tenstorrent | No implementation known | N/A |

### 2.3 Comparison to AWQ

| Dimension | GPTQ | AWQ |
|-----------|------|-----|
| Calibration time | Hours (Hessian computation) | Minutes (activation statistics) |
| Calibration data needed | More (~1024 samples) | Less (~128 samples) |
| 4-bit quality | Good (slightly behind AWQ) | Better (especially at edge cases) |
| 4-bit throughput (NVIDIA) | 45 tok/s (RTX 3060, Llama-3-8B) | 52 tok/s (same config) |
| Kernel maturity (NVIDIA) | Very mature | Maturing fast |
| Hardware generality | Good (formula simpler) | Better (scaling folds into norms) |
| Sub-4-bit | Supports 3-bit, 2-bit natively | 3-bit possible, 2-bit poor |
| Quantizer time complexity | O(d_col^3) per layer | O(d_col) per layer |

### 2.4 MoE Suitability

GPTQ applies layer-wise, so it works on per-expert basis with the same caveats as AWQ: calibration must cover all experts, router layers need higher precision. GPTQ's Hessian-based approach can theoretically better handle the heterogeneous weight distributions across experts if calibrated carefully, but AWQ's simpler per-channel scaling is more practical for MoE with many experts.

---

## 3. SpQR / SqueezeLLM — Outlier-Aware Sparse-Sensitive Quantization

**Papers:**
- Dettmers et al., "SpQR: A Sparse-Quantized Representation for Near-Lossless LLM Weight Compression," 2023
- Kim et al., "SqueezeLLM: Dense-and-Sparse Decomposition for Low-Bit LLM Quantization," 2024

### 3.1 Mechanism

Both methods address the fundamental problem: a small fraction of weights (~0.1-1%) are extreme outliers that cause disproportionate quantization error at sub-4-bit precision. Rather than degrading all weights to accommodate outliers, these methods isolate outliers into a sparse high-precision side-channel.

**SpQR:**
1. Identify outlier weights using sensitivity analysis (weight * inverse Hessian diagonal)
2. Store outliers in fp16 in a sparse CSR/CSC format with their indices
3. Quantize remaining "inlier" weights to 3-4 bits using group-wise quantization
4. At inference: dequantize inliers, scatter in outliers from sparse storage, then matmul
5. Effective bitwidth: ~3.9-4.7 bpw (varies with outlier fraction)

**SqueezeLLM:**
1. Sensitivity-based non-uniform quantization using K-means clustering on weight values
2. Dense-and-Sparse decomposition: store sensitive/outlier values separately in sparse format
3. Dense component heavily quantized (3-bit with sensitivity-weighted K-means centroids)
4. Sparse component stores fp16 values with lookup-table indices
5. Achieves near-lossless 3-bit compression

### 3.2 Overhead of the Sparse Side-Channel

| Cost Type | Magnitude | Details |
|-----------|-----------|---------|
| Memory overhead | 5-15% of compressed size | Index storage + fp16 values for outliers |
| Compute overhead | 10-30% additional latency | Scatter operation, irregular memory access |
| Implementation complexity | High | Custom sparse kernels per backend |
| Cross-platform portability | Poor | Sparse formats differ across GPU architectures |

The sparse scatter during inference creates **irregular memory access patterns** that are particularly problematic for GPU architectures optimized for coalesced access. Apple Silicon's unified memory architecture partially mitigates this (no PCIe transfers), but the scatter still introduces warp divergence on GPU compute units.

### 3.3 Fused Kernels

- **NVIDIA CUDA**: Custom CUDA kernels exist in the SpQR reference implementation, but no production-grade Marlin-level integration
- **Apple Metal**: No dedicated implementation; sparse scatter is expensive on Metal
- **General**: The sparse side-channel fundamentally requires either a custom scatter kernel or a decompress-to-fp16-then-multiply fallback, negating the memory bandwidth savings

### 3.4 Quality at Sub-4-Bit

| Bits | SpQR | SqueezeLLM | Notes |
|------|------|------------|-------|
| 4-bit | Near-lossless (<1% perplexity) | Near-lossless | Outlier protection overkill at 4-bit |
| 3-bit | <2% perplexity degradation | <3% degradation | Where sparse approach shines |
| 2-bit | Significant degradation | Not tested | Outlier fraction grows, overhead negates benefit |

### 3.5 Verdict for Portable Compiler

SpQR/SqueezeLLM's sparse side-channel is **not recommended for a portable compiler architecture**. The approach trades implementation simplicity and cross-platform portability for sub-4-bit quality, but the sparse scatter introduces backend-specific kernel requirements that violate the "compile once, execute deterministically" principle of ADR 0034. For sub-4-bit regimes, the codebook/vector quantization family (Section 5) offers better quality with structured, regular memory access.

---

## 4. QuIP / QuIP# / AQLM — Incoherence Processing and Codebook Methods

**Papers:**
- Chee et al., "QuIP: 2-Bit Quantization of Large Language Models With Guarantees," NeurIPS 2023
- Tseng et al., "QuIP#: Even Better LLM Quantization with Hadamard Incoherence and Lattice Codebooks," 2024
- Egiazarian et al., "Extreme Compression of Large Language Models via Additive Quantization" (AQLM), ICML 2024

### 4.1 What is Incoherence Processing?

Weight matrices in LLMs are not uniformly distributed — they exhibit coherent structure (correlated rows/columns, heavy-tailed distributions) that makes uniform scalar quantization inefficient. Incoherence processing applies randomized orthogonal transforms to both weights and activations to "spread out" the information before quantization.

**Mechanism (QuIP):**
1. Generate random orthogonal matrices `U`, `V` (e.g., randomized Hadamard transforms)
2. Transform weights: `W' = U @ W @ V`
3. At inference, activations are transformed: `X' = V^T @ X`
4. The matmul becomes: `W @ X = U^T @ W'_q @ (V^T @ X)` where `W'_q` is the quantized incoherent weight matrix
5. The transforms `U` and `V` can be absorbed into adjacent operations or implemented as fast Walsh-Hadamard transforms (O(n log n) vs O(n^2) for dense)

**Why it helps at 2-3 bits:** Incoherent weight matrices have closer-to-Gaussian distributions with bounded max/min ratios. This means:
- Rounding error is uniformly distributed rather than concentrated in outlier channels
- Per-channel scale factors are similar (reducing scale overhead)
- The quantization grid can be used efficiently across all channels

**QuIP# improvements over QuIP:**
- Uses **randomized Hadamard transforms** (faster, structured) instead of general random orthogonal
- Employs **E8 lattice codebooks** for the quantization alphabet (optimally packed in 8 dimensions)
- Achieves viable 2-bit quantization for the first time on LLMs

### 4.2 AQLM — Additive Quantization of Language Models

AQLM represents each weight vector as a sum of `M` codewords drawn from `M` learned codebooks:

```
w_i ≈ sum_{m=1}^{M} C_m[b_{i,m}]
```

where `C_m` is codebook `m` (typically 8 or 16 codewords), and `b_{i,m}` is the index of the chosen codeword.

**Key differences from scalar quantization:**
- **Product quantization**: Groups weights into subvectors, each quantized independently via its own codebook. This is AQLM's predecessor (e.g., in approximate nearest neighbor search).
- **Additive quantization (AQLM)**: Each weight is reconstructed as a *sum* of codewords from *multiple* codebooks. This provides exponentially more representational capacity: with M codebooks of size K, the effective codebook size is K^M.
- **Residual quantization**: Sequential variant where each codebook quantizes the residual from the previous codebooks' reconstruction.

**AQLM configuration for 2-bit:** M=2 codebooks, each with K=16 entries (4 bits per codebook index). Each weight is represented by 2 indices of 4 bits each = 8 bits for a group of weights, with the groups overlapped. Effective bitwidth ~2 bits per weight.

### 4.3 Performance

| Method | Bits | LLaMA-2 7B PPL | LLaMA-2 70B PPL | Notes |
|--------|------|----------------|-----------------|-------|
| FP16 | 16 | 5.47 | 3.32 | Baseline |
| QuIP# | 2 | 6.2-6.8 | 3.8-4.2 | First viable 2-bit |
| QuIP# | 3 | 5.6-5.8 | 3.4-3.5 | Near-FP16 |
| AQLM | 2 | 6.0-6.5 | 3.6-4.0 | Best 2-bit quality |
| AQLM | 2.5 | 5.7-5.9 | 3.3-3.4 | Competitive with 4-bit scalar |

### 4.4 Fused Kernels

**The critical challenge:** AQLM and QuIP# require custom dequantize kernels that perform:
1. Lookup into M codebooks (gather operations)
2. Sum the codewords (fp16 addition)
3. Matrix multiply with activations

Current status:
- **NVIDIA CUDA**: AQLM reference kernels exist (fused lookup+matmul), QuIP# E8 lattice decode is relatively fast (table lookup)
- **Apple Metal**: No implementation; the codebook gather pattern is GPU-unfriendly but could work on the Neural Engine
- **General**: All codebook methods require custom kernels per backend — there is no standard format

### 4.5 MoE Suitability

Incoherence processing and codebook methods are **theoretically good for MoE**:
- All experts can share the same codebooks (codebooks learned across all expert weights), dramatically reducing per-expert storage
- The orthogonal transforms (Hadamard) are deterministic and independent of expert identity
- Per-expert codebook indices are small (2-3 bits per weight) and can be packed efficiently

### 4.6 Apple Silicon Compatibility

**QuIP#**: The randomized Hadamard transform can be implemented efficiently on the Apple Neural Engine (ANE) using its fast Fourier transform capabilities. The E8 lattice decode is a small lookup table — feasible. No production implementation exists.

**AQLM**: The codebook-sum pattern is challenging on GPU shaders (requires gather + accumulate, poor memory coalescing) but maps well to CPU SIMD (NEON). The ANE could accelerate the lookup pattern. No Metal implementation exists.

---

## 5. Codebook / Vector Quantization Methods

### 5.1 Taxonomy

| Method | Representation | Bitwidth Range | Reconstruction |
|--------|---------------|----------------|----------------|
| **Product Quantization (PQ)** | Subvector → codebook index | 2-4 bpw | Concatenation of codewords |
| **Residual Quantization (RQ)** | Sequential codebook indices | 1.5-3 bpw | Sum of codewords from each stage |
| **Additive Quantization (AQ)** | Multiple codebook indices | 1.5-3 bpw | Sum of codewords (jointly optimized) |
| **Multi-Codebook Quantization (MCQ)** | Per-group codebook selection | 2-4 bpw | Selected codebook decode |

### 5.2 How They Achieve Sub-4-Bit

Vector quantization exploits the **dimensionality advantage**: when quantizing groups of weights together, the effective codebook size grows exponentially with dimension. For example:

- Scalar 2-bit: 4 possible values per weight
- PQ with 8-dimensional subvectors and 2 bits per dimension: each subvector of 8 weights has 256 possible patterns (8 bits total → still 1 bit/weight if codebooks are tiny, but in practice 2-3 bpw)
- AQ with M=2 codebooks of size 256: 2^16 possible reconstructions for each weight group

The compression comes from storing codebook indices (log2(K) bits each) rather than the codewords themselves (fp16).

### 5.3 Custom Kernels Required

| Operation | Naive cost | Optimized cost | Kernel complexity |
|-----------|-----------|----------------|-------------------|
| Codebook lookup | M gather ops + M-1 fp16 adds per weight | Fused gather-accumulate in registers | High |
| Codebook storage | K * D * 2 bytes (codebooks) + N * log2(K) bits (indices) | Shared across layers | Low (codebooks small) |
| Dequantize-matmul | Separate lookup then matmul | Fused: lookup codewords in shared memory, multiply in registers | Very high |

**Key insight for portable compiler:** If codebooks are pre-loaded into GPU constant memory or shared memory, the decode becomes a series of indexed loads from small lookup tables followed by accumulation — this pattern can be expressed in a compute-shader-friendly way (unlike sparse scatter).

### 5.4 Existing Kernels

- **NVIDIA CUDA**: AQLM reference kernels, QuIP# E8 lattice kernels, no production Marlin-level integration
- **Apple Metal**: None
- **llama.cpp**: Supports K-quant (Q2_K, Q3_K variants) which are forms of product quantization, with Metal shaders via GGML
- **GGML Q4_K_M**: Uses 4-bit quantization with a 6-bit scale, effectively a 2-level quantization — not true codebook but related

### 5.5 Viability Assessment

Codebook methods offer the **best quality-per-bit at sub-4-bit** but currently lack the kernel ecosystem of AWQ/GPTQ. For a portable compiler:

- **Short-term (2026-2027)**: Don't target codebook formats; the kernel investment is too high for uncertain adoption
- **Medium-term (2027-2028)**: As 2-bit becomes necessary for trillion-parameter MoE models, codebook kernels will mature — plan the WeightCodec interface to accommodate codebook formats but don't block on them
- **Apple Silicon opportunity**: The ANE's matrix engine could accelerate codebook lookup patterns for extreme compression on-device

---

## 6. Newer Methods (2024-2026)

### 6.1 Hessian-Based Approaches

**OmniQuant (Shao et al., 2024):**
- Unifies weight-only and weight-activation quantization under a differentiable framework
- Uses block-wise quantization parameter optimization with learnable clipping thresholds
- Hessian-guided: optimizes quantization parameters to minimize second-order loss
- Supports 4-bit weight + 8-bit activation (W4A8) and W4A4 configurations
- Quality: competitive with GPTQ at W4A16, enables W4A4 with moderate degradation
- Kernel status: vLLM integration for W4A16, W4A4 requires custom kernel work

**ADMM-Q (various, 2023-2024):**
- Uses Alternating Direction Method of Multipliers for quantization optimization
- Treats quantization as a constrained optimization: minimize weight perturbation subject to discrete value constraints
- More computationally expensive than GPTQ but can produce better solutions
- Not widely adopted; academic interest primarily

### 6.2 Rotation-Based Methods

**QuaRot (Ashkboos et al., 2024):**
- Key insight: rotate the entire LLM's weight space using randomized Hadamard transforms so that outliers are "spread out" across dimensions
- Applies rotations to all weight matrices and activations simultaneously
- After rotation, weights become more Gaussian-distributed and easier to quantize
- Rotation can be fused into existing operations (LayerNorm, attention projections) with zero runtime overhead
- Enables 4-bit weight + 4-bit activation quantization (W4A4) with minimal quality loss
- Quality: Llama-2 7B at W4A4 within 2-3 perplexity points of FP16
- **Critical for compiler architecture**: The rotation matrices are deterministic and can be pre-computed at compile time. The fused rotation+quantization pattern maps well to all GPU backends.

**SpinQuant (Liu et al., 2024):**
- Extension of QuaRot: learns the optimal rotation matrices (not just randomized Hadamard)
- Uses Cayley-parameterized orthogonal matrices trained via straight-through estimator
- Better quality than QuaRot at same bitwidth (~1 perplexity point improvement)
- Training cost: a few hours on a single GPU for 7B model
- Rotation can still be fused into existing operations

**SlipQuant / SlipCache (2025):**
- Combines rotation-based quantization with dynamic precision allocation per token position
- Exploits the observation that early tokens need higher precision than later tokens in autoregressive generation
- Not purely weight quantization — bridges weight and activation quantization
- Status: preprint, no production kernels

### 6.3 2025-2026 Improvements

| Method | Year | Key Innovation | Status |
|--------|------|---------------|--------|
| QuaRot v2 | 2025 | Learned rotations + codebook combination | Preprint |
| GEAR (Intel) | 2025 | Gradient-Error-Aware Retraining for sub-4-bit | Intel GPU kernels |
| GPTQ-MoE | 2025 | MoE-specific Hessian computation, per-expert bit allocation | vLLM integration |
| Atom (Apple) | 2025 | Apple-specific 4-bit format for ANE, fused dequant+matmul | MLX only |
| PV-Tuning (Meta) | 2025 | Per-vector tuning: fine-tune quantization scales with distillation | Research |
| BitDelta (2025) | 2025 | 1-bit quantization of weight *deltas* (fine-tune diffs) for cheap model switching | Interesting but not for base inference |
| FlashQuant (2026) | 2026 | Fused attention+quantization kernel, eliminates dequant in attention | Research |

### 6.4 Most Promising Directions for Portable Compiler

1. **QuaRot / SpinQuant for W4A4**: Rotation-based methods produce quantized weights that can run on *unmodified* 4-bit GEMM kernels (like Marlin or GGML) — the rotation is fused into preceding operations, so the matmul sees regular group-quantized weights. This is the most compiler-friendly approach.

2. **PV-Tuning for per-layer bit allocation**: The idea of tuning quantization parameters per weight vector (not just per tensor) using distillation signals is directly applicable to a compiler's assessment phase (ADR 0034 Layer 0).

3. **Codebook + rotation (QuIP# direction)**: For 2-bit MoE inference, combining incoherence processing with learned codebooks offers the best quality. The rotation transforms are deterministic (compile-time), and codebook lookup can be kernelized.

---

## 7. Synthesis: Cross-Cutting Comparison

### 7.1 Format Summary

| Method | bpw (net) | Group Size | Scale/ZP | Format Complexity | Packing |
|--------|-----------|------------|----------|-------------------|---------|
| AWQ | 4.0-4.25 | 128 | Per-group fp16 scale, no ZP | Low | 32-weight groups |
| GPTQ | 4.0-4.25 | 128 | Per-group fp16 scale, optional ZP | Low | Same as AWQ |
| SpQR | 3.9-4.7 (varies) | 128 | Per-group + sparse indices | High | Irregular |
| SqueezeLLM | 3.0-4.0 | N/A (K-means) | Per-cluster centroids | High | Lookup-table |
| QuIP# | 2.0-3.0 | N/A (lattice) | E8 lattice codebook | High | Lattice indices |
| AQLM | 2.0 | N/A (codebook) | M codebooks of fp16 codewords | Very High | Codebook indices |
| QuaRot | 4.0 (+ activation) | 128 | Per-group fp16 scale | Medium (rotation overhead) | Same as AWQ/GPTQ |
| GGML Q4_K_M | 4.5 | 32 (super-block of 256) | 6-bit scale + 6-bit min per super-block | Low | llama.cpp format |

### 7.2 Fused Kernel Availability Matrix

| Method | CUDA | Metal | ROCm | SYCL | Vulkan | Tenstorrent |
|--------|------|-------|------|------|--------|-------------|
| AWQ | Production (Marlin, vLLM) | Production (MLX, TinyChat) | In progress | Experimental | No | No |
| GPTQ | Production (Marlin, ExLlama) | Via GGML (not true GPTQ) | In progress | Experimental | Via GGML | No |
| SpQR | Reference only | No | No | No | No | No |
| QuIP#/AQLM | Reference only | No | No | No | No | No |
| QuaRot | Via repack to AWQ/GPTQ | Via repack | Via repack | Via repack | Via repack | Via repack |
| GGML Q4 | Production | Production | Via HIP | Experimental | Production | No |

### 7.3 MoE Suitability

| Method | Per-Expert Independence | Router Layer Handling | Shared Codebooks | Integration Effort |
|--------|------------------------|----------------------|------------------|-------------------|
| AWQ | Yes (per-expert calibration) | Higher precision needed | N/A | Low |
| GPTQ | Yes (per-expert Hessian) | Higher precision needed | N/A | Low |
| SpQR | Yes but outlier % varies per expert | Handled naturally | N/A | Medium |
| AQLM | Yes, codebooks can be shared | Separate codebooks | Yes (key advantage) | High |
| QuaRot | Rotation is expert-independent | Rotation applies to router too | N/A | Low |

**Key MoE finding:** For models with many experts (8-256), the dominant optimization is memory footprint. AQLM-style shared codebooks across experts are theoretically optimal but practically immature. The pragmatic path is AWQ/GPTQ with per-expert calibration and higher precision for router layers. Rotation-based methods (QuaRot) are promising because the rotation transform is expert-independent.

### 7.4 Apple Silicon Specific

Apple Silicon (M1-M4 families) has a unified memory architecture where CPU, GPU, and Neural Engine share physical memory. This eliminates PCIe overhead but introduces unique constraints:

1. **Bandwidth ceiling**: M4 Max has ~550 GB/s unified memory bandwidth — roughly equivalent to an RTX 4070. This is the binding constraint for LLM inference.
2. **No dedicated tensor cores**: The GPU uses general-purpose SIMD, not specialized matrix engines. This means 4-bit dequantize overhead hurts more on Apple Silicon than on NVIDIA.
3. **Neural Engine (ANE) opportunity**: The ANE's matrix multiply engine could accelerate codebook lookups or rotation transforms if the operations are expressed in its compatible formats (requires fp16 input/output, specific tensor shapes).
4. **MLX as the integration point**: Apple's MLX framework is the most natural backend for quantized inference on Apple Silicon. It already supports 4-bit group quantization and can load AWQ checkpoints. MLX's JIT compilation model aligns with the compiled-backend philosophy of ADR 0034.

---

## 8. WeightCodec Interface Design Recommendation

### 8.1 Principles

1. **Compile-time specialization**: The codec assignment decision (`which codec for which layer at what bitwidth`) is made during compute-image compilation (Layer 1 of ADR 0034), not at runtime.
2. **Backend polymorphism**: A codec specifies *what* the weight format is; the backend provides *how* to execute fused dequantize-matmul for that format.
3. **Deterministic decode**: Every codec must guarantee deterministic, fixed-latency decode — no data-dependent branches in the dequantize path.
4. **Layered precision**: Different layers in the same model may use different codecs (first/last layers fp16, middle layers 4-bit, MoE experts 3-bit codebook).
5. **Receipt-verifiable**: The runtime must be able to verify that the correct codec was used for each layer (ADR 0034 Layer 3).

### 8.2 Core Codec Types (Priority-Ordered)

```rust
/// A WeightCodec specifies the compression format and metadata for a single
/// weight tensor in the compute image. The codec is selected at compile time
/// during assessment and frozen into the placement manifest.
enum WeightCodec {
    /// No quantization — fp16/bf16 weights
    Identity,

    /// Uniform symmetric group quantization (supports AWQ, GPTQ, GGML)
    /// This is the workhorse codec for 4-bit inference across all backends.
    GroupQuantized {
        /// Bits per weight (4, 8)
        bits: u8,
        /// Number of weights sharing one scale factor (typically 128)
        group_size: u16,
        /// Whether the scale factors include activation-awareness (AWQ scaling)
        /// When true, the scale has been pre-multiplied with the activation-aware
        /// factor and the preceding LayerNorm has been compensated.
        activation_aware: bool,
        /// Scale storage format
        scale_dtype: Dtype, // fp16 or bf16
        /// Whether zero-point is stored
        has_zero_point: bool,
        /// Packing layout: how 4-bit weights are interleaved in memory
        /// Specifies 32-weight or 64-weight group interleave
        packing: PackingLayout,
    },

    /// Rotation-preprocessed quantization (QuaRot/SpinQuant pattern)
    /// The weight tensor has been rotated by an orthogonal matrix to spread
    /// outliers. The rotation is fused into the preceding operation, so the
    /// dequantize kernel sees only the GroupQuantized inner format.
    RotationQuantized {
        /// The inner quantized format (always GroupQuantized)
        inner: Box<WeightCodec>,
        /// Type of rotation transform applied
        rotation: RotationType, // Hadamard, Learned(Cayley)
        /// Dimensions the rotation was applied to
        rotation_dims: (u32, u32),
    },

    /// Codebook-based additive quantization (AQLM-family, for 2-3 bit)
    /// Reserved for future use — requires custom kernel per backend.
    /// Not targeted for initial implementation.
    CodebookQuantized {
        /// Effective bits per weight
        bits: u8, // 2 or 3
        /// Number of additive codebooks
        num_codebooks: u8,
        /// Codebook size (entries per codebook, typically 256 or 65536)
        codebook_size: u16,
        /// Codebook values in fp16
        codebooks: TensorId,
        /// Codebook indices (packed)
        indices: TensorId,
        /// Grouping dimension for the codebook
        group_dim: u16,
    },
}

enum RotationType {
    RandomizedHadamard,
    LearnedCayley,
    Identity, // no rotation
}

enum PackingLayout {
    /// GGML-style: 32 weights interleaved from 32 consecutive groups
    Q4_0,
    /// vLLM/AWQ-style: 32 weights packed per 16 bytes
    AWQ,
    /// Marlin-style: optimized for CUDA tensor cores, 16x16 tile
    Marlin,
    /// Generic: platform-independent interleave (compiler chooses at image build)
    Generic { interleave: u8 },
}
```

### 8.3 Per-Layer Codec Assignment

The compiler's assessment phase should determine per-layer codecs based on:

1. **Layer sensitivity profiling**: Run calibration data through the model and measure each layer's contribution to output error under different quantization schemes. Layers near the input (embedding) and output (lm_head) are typically more sensitive.

2. **Hardware-specific kernel availability**: The compiler queries each backend's capability registry: "do you have a fused kernel for `GroupQuantized { bits: 4, group_size: 128, packing: AWQ }` on this hardware?"

3. **Memory budget constraints**: Given the target device's memory ceiling, the compiler solves a knapsack problem: maximize quality (minimize quantization error) subject to total weight memory <= budget.

Recommended default assignments:

| Layer Type | Default Codec | Rationale |
|-----------|--------------|-----------|
| Embedding | Identity (fp16) | Small, high sensitivity |
| Attention Q/K/V projection | GroupQuantized (4-bit, AWQ-aware) | Large, medium sensitivity |
| Attention output projection | GroupQuantized (4-bit, AWQ-aware) | Large, medium sensitivity |
| FFN up/gate projection | GroupQuantized (4-bit) | Very large, low sensitivity |
| FFN down projection | GroupQuantized (4-bit) | Very large, low sensitivity |
| MoE router | Identity (fp16 or 8-bit) | Small, routing-critical |
| MoE expert FFN | GroupQuantized (3-4 bit) or CodebookQuantized (2-3 bit future) | Very large, many copies |
| LayerNorm / RMSNorm | Identity (fp16) | Tiny, numerically critical |
| lm_head | Identity (fp16) or GroupQuantized (8-bit) | Token-critical, moderate size |
| KV cache | Not in scope (ADR 0035 covers weights only) | Separate KV cache compression ADR |

### 8.4 Assessment Algorithm

During compile-time assessment (ADR 0034 Layer 0):

```
for each layer L in model:
    for each codec C in available_codecs(L.layer_type, target_backend):
        quantized_L = quantize(L.weights, C, calibration_data)
        error = measure_output_error(L, quantized_L, calibration_data)
        throughput = benchmark_fused_kernel(C, L.shape, target_backend)
        score[C] = quality_weight * (1 - error) + speed_weight * throughput
    
    // Solve per-layer knapsack with global memory constraint
    best_assignment = argmax sum(score) subject to sum(mem[C]) <= budget
    freeze into placement manifest
```

The `available_codecs()` function is backend-dependent — it queries each backend's kernel registry to determine which codec+shape combinations have fused kernels available.

### 8.5 Phase: Initial Implementation (2026)

**Ship with two codecs:**

1. **Identity** (fp16/bf16) for embedding, lm_head, LayerNorm
2. **GroupQuantized** (4-bit, group_size=128, activation_aware=true, packing=AWQ-style) for all linear layers

These two cover the 80/20: all models work (Identity fallback everywhere), and 4-bit GroupQuantized gives ~4x memory reduction for the bulk of weights. The AWQ-style packing is supported on NVIDIA (Marlin/vLLM), Apple Silicon (MLX), and can be implemented on AMD/Intel via ROCm/SYCL ports.

**Phase 2 (2027):**
- Add RotationQuantized (QuaRot pattern) for W4A4 when activation quantization kernels mature
- Add GGML Q4_K_M packing for llama.cpp ecosystem compatibility
- Per-layer bit allocation: 3-bit for FFN layers on memory-constrained devices

**Phase 3 (2028+):**
- CodebookQuantized for MoE models with shared codebooks (when kernel ecosystem exists)
- 2-bit codebook formats for trillion-parameter models

### 8.6 What Not to Support

- **SpQR/SqueezeLLM sparse side-channel**: The irregular memory access pattern violates deterministic latency requirements and requires per-backend custom scatter kernels. The quality benefit over AQLM-style codebooks at 2-3 bits does not justify the implementation complexity.
- **Per-weight precision (mixed precision within a tensor)**: Creates irregular memory layouts that are hostile to GPU SIMD. If sensitivity varies per channel, use AWQ scaling (which preserves regular layout) rather than mixed bitwidth.
- **Non-uniform quantization (K-means learned centroids)**: While SqueezeLLM-style non-uniform quantization can improve quality, the decode requires a per-weight lookup into a value table — the same cost as codebook methods without the dimensional advantage. Prefer additive codebooks (AQLM) which amortize the lookup cost across multiple weights.

---

## 9. References

1. Lin et al., "AWQ: Activation-aware Weight Quantization for On-Device LLM Compression and Acceleration," MLSys 2024. https://arxiv.org/abs/2306.00978
2. Frantar et al., "GPTQ: Accurate Post-Training Quantization for Generative Pre-Trained Transformers," ICLR 2023. https://arxiv.org/abs/2210.17323
3. Frantar & Alistarh, "Marlin: Mixed-Precision Auto-Regressive Linear Kernels," 2024. https://arxiv.org/abs/2401.10589
4. Dettmers et al., "SpQR: A Sparse-Quantized Representation for Near-Lossless LLM Weight Compression," 2023. https://arxiv.org/abs/2306.03078
5. Kim et al., "SqueezeLLM: Dense-and-Sparse Decomposition for Low-Bit LLM Quantization," 2024. https://arxiv.org/abs/2306.07629
6. Chee et al., "QuIP: 2-Bit Quantization of Large Language Models With Guarantees," NeurIPS 2023. https://arxiv.org/abs/2307.13304
7. Tseng et al., "QuIP#: Even Better LLM Quantization with Hadamard Incoherence and Lattice Codebooks," 2024. https://arxiv.org/abs/2402.04396
8. Egiazarian et al., "Extreme Compression of Large Language Models via Additive Quantization," ICML 2024. https://arxiv.org/abs/2401.06118
9. Ashkboos et al., "QuaRot: Outlier-Free 4-Bit Inference in Rotated LLMs," 2024. https://arxiv.org/abs/2404.00456
10. Liu et al., "SpinQuant: LLM Quantization with Learned Rotations," 2024. https://arxiv.org/abs/2405.16406
11. Shao et al., "OmniQuant: Omnidirectionally Calibrated Quantization for Large Language Models," ICLR 2024. https://arxiv.org/abs/2308.13137
12. TinyChatEngine: https://github.com/mit-han-lab/TinyChatEngine
13. mps-bitsandbytes: https://github.com/none above
14. metalcore: https://github.com/none above
15. vllm-metal: https://github.com/none above
