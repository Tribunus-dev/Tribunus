# Autoregressive Decode Runtime Pipeline: Industry Patterns and Tribunus Recommendations

June 2026 | ResearchDecode

---

## 1. Continuous Batching: Iteration-Level Scheduling

### 1.1 vLLM's Rolling Batch Architecture

vLLM's scheduler operates at **token generation granularity** — each forward pass ("iteration") recomputes batch membership from scratch. This is fundamentally different from static batching, which waits for all sequences in a batch to complete. The key mechanism:

- **Running queue priority**: After each iteration, the scheduler first fills the batch with active decode requests, then tops off with prefill chunks or waiting requests. This biases toward decode latency (inter-token latency, ITL) rather than prefill throughput (time-to-first-token, TTFT). Exit is immediate — an EOS token removes the sequence from the next iteration.
- **"Super-sequence" representation**: All active sequences are flattened and concatenated into a single sequence. FlashAttention-style kernels process this with causal masks that isolate each request's tokens. No padding tokens — every GPU FLOP processes a real token.
- **PagedAttention KV block manager**: KV cache is allocated in fixed-size blocks (default 16 tokens). A logical-to-physical block table maps each sequence's positions to non-contiguous GPU memory blocks. When a sequence finishes or is preempted, its blocks are returned to the free pool instantly. New requests reuse freed blocks on the next iteration.
- **Three queues**: Waiting (arrived, not yet started), Running (actively decoding), Swapped (KV blocks evicted to CPU memory, to be recomputed on re-admission).
- **Chunked prefill** (V1 default since 2025): Long prefill prompts are split into fixed-size chunks (typically 512-2048 tokens) processed across multiple iterations. The scheduler interleaves decode steps between prefill chunks — a long prompt never starves decoding. `max_num_batched_tokens` caps total tokens per iteration and acts as the prefill chunk cap. Chunked prefill is compatible with prefix caching, speculative decoding, and tensor parallelism.

### 1.2 Sarathi-Serve's Stall-Free Scheduling

Sarathi-Serve (USENIX 2024) refines continuous batching with **stall-free** admission: new requests or prefill chunks join a running batch without pausing ongoing decodes. The key insight is that coalescing decode tokens (memory-bound, few tokens) with prefill chunks (compute-bound, many tokens) creates **uniform batches** that reduce GPU pipeline bubbles. Sarathi-Serve reports 2.6-3.7x throughput gains over vLLM on A100 GPUs.

### 1.3 TensorRT-LLM's In-Flight Batching

NVIDIA's term for continuous batching. TensorRT-LLM processes prefill and decode concurrently — the "in-flight" batch can contain a mix of prefill tokens (variable lengths) and decode tokens (one per active sequence). The scheduler adds/removes requests at iteration boundaries, with KV cache allocated from a fixed-size memory pool.

### 1.4 Tribunus Implications

Tribunus' precompiled compute-image model changes the batching dynamic. Since every kernel, memory buffer, and arena page is pre-declared, the scheduler is not "discovering" batch layouts — it is **selecting from prequalified batch families**. The compiler generates a finite set of batch configurations (e.g., `{decode: 1, 2, 4, 8, 16, 32, 64, 128}`) and the runtime picks the closest one, padding idle slots with null tokens. This is isomorphic to TensorRT-LLM's CUDA Graph padding but extends to all backends (Metal, ANE, Accelerate, Vulkan, HIP).

**Recommendation**: Implement a multi-queue iteration-level scheduler inspired by vLLM V1 but with prequalified batch families as the atomic scheduling unit. Use Tribunus' typed ring buffers (ADR 0036) instead of vLLM's block table — the KV ring already models append-heavy, branch-aware paging with generation counters.

---

## 2. CUDA Graphs for Decode: Capture, Replay, Dynamic Updates

### 2.1 Why Decode Benefits from Graph Capture

The decode phase is the ideal candidate for kernel-launch amortization because it is **shape-stable**: each iteration processes exactly one new token per active sequence, and the batch size changes only at iteration boundaries (not mid-kernel). A single `cuGraphLaunch` replaces dozens of individual `cuLaunchKernel` calls. NVIDIA reports "nearly constant launch times for straight-line kernel graphs" as of CUDA 12.6 — the CPU overhead per kernel launch drops from ~5-10 us to effectively zero.

### 2.2 TensorRT-LLM's Three-Layer Graph Strategy

**Monolithic capture**: The entire forward pass (attention + MLP + logits) is captured as one graph. Replayed every decode token. Simple but must be re-captured when batch size or sequence length changes. Works well for pure-decode batches where shape is stable.

**CUDA Graph padding (the pragmatic approach)**: Batch sizes are bucketed (1, 2, 4, 8, 16, 32, 64, 128). The scheduler captures one graph per bucket. An incoming batch of size N is padded to the next larger bucket by inserting dummy tokens. Padded tokens compute "wasted" FLOPs but eliminate CPU overhead. TensorRT-LLM reports up to 22% end-to-end throughput gain from graph padding. Configuration: `cuda_graph_max_batch_size` and `cuda_graph_padding_enabled`.

**Piecewise CUDA Graphs (2025+)**: The attention mechanism (highly dynamic due to sequence lengths) runs in eager mode, while the stable MLP/norm/logits segments are captured as individual graph segments. This reduces Time-To-First-Token for prefill-heavy workloads where attention shapes vary dramatically. NVIDIA's AutoDeploy (2026 beta) automates piecewise graph generation from `torch.compile`.

**Conditional nodes (Hopper/Blackwell, CUDA 12.4+)**: `cuGraphConditionalHandle` with IF/WHILE nodes enables variable sequence length within a single graph. A WHILE node encapsulates the per-token decode loop body — the GPU executes tokens iteratively without CPU involvement. IF nodes handle early-stopping and EOS detection. This eliminates re-capture cost entirely and is the direction NVIDIA is pushing for Blackwell (CUDA 12.8 adds IF/ELSE and SWITCH nodes).

### 2.3 Dynamic Shape Handling

CUDA Graphs traditionally cannot handle dynamic input shapes — the tensor dimensions passed at capture time are baked into the graph. TensorRT-LLM's approach:
1. **Shape bucketing**: Pre-capture graphs for common (batch_size, max_seq_len) combinations.
2. **Graph padding**: Pad to the nearest larger supported shape.
3. **Re-capture on miss**: If a shape has no pre-captured graph, fall back to eager mode for that iteration and asynchronously capture a new graph.
4. **Piecewise**: Isolate the dynamic parts (attention) from the static parts (MLP) so only the dynamic segments need re-capture.

### 2.4 Tribunus Implications: Precompiled Compute Images

Tribunus eliminates the re-capture problem entirely. The compiler pre-declares every kernel, every batch configuration, and every memory layout. The compute image is the graph — not a CUDA Graph per se, but a **placement manifest** that maps every phase to a precompiled kernel on a specific backend lane with a specific arena page lease.

On NVIDIA hardware, Tribunus should emit pre-captured CUDA Graphs for each batch-size family as part of the compute image (compilation time, not runtime). On Apple Silicon, the equivalent is **precompiled Metal libraries** (MTLLibrary from metallib) loaded once at session start. There is no runtime graph discovery, no shape re-capture, no fallback to eager mode.

**Recommendation**: For NVIDIA backends, emit a family of pre-captured CUDA Graphs (batch sizes 1, 2, 4, 8, 16, 32, 64, 128) during compute-image compilation, using graph padding for intermediate sizes. Investigate conditional WHILE nodes for Blackwell GPUs to eliminate batch-size bucketing entirely. For Metal, emit precompiled `.metallib` bundles and use MTLIndirectCommandBuffer for replay — no JIT in the hot path.

---

## 3. Decoder Phase Sequence: Attention-MLP Overlap

### 3.1 Standard Decode Phase Order

For each decode token, the canonical forward pass order per transformer layer is:

1. **KV gather**: Read K/V tensors from KV cache at current position (memory-bound, tiny compute)
2. **Attention**: Q * K^T → softmax → score * V (memory-bound for decode — only 1 query token, bandwidth-limited)
3. **MLP**: Two dense matmuls with activation (compute-bound, weight-loading dominates)
4. **RMSNorm / LayerNorm**: Element-wise reduction (low FLOPs, memory-bound)
5. **Logits projection**: Final vocabulary projection (compute-bound for large vocabs)

The key asymmetry: decode attention is **memory-bound** (reads large K/V tensors, computes little), while MLP is **compute-bound** (large matmuls). On a GPU, attention under-utilizes compute — the SMs that compute attention sit partially idle waiting for memory. MLP saturates compute but must wait for attention to finish (data dependency on attention output).

### 3.2 POD-Attention: SM-Level Prefill-Decode Overlap

POD-Attention (ASPLOS 2025) is the first GPU kernel that **co-schedules prefill and decode attention on the same Streaming Multiprocessor (SM)**. Prefill attention (compute-bound, many query tokens) and decode attention (memory-bound, one query token) have complementary resource profiles. POD-Attention allocates some SMs to prefill compute while others service decode memory accesses, achieving up to 59% faster attention computation (28% mean). The key mechanism is **threadblock-level resource partitioning** — each SM's warp scheduler interleaves prefill compute instructions with decode memory loads.

### 3.3 MHA-MLP Parallelism via Separate Streams

In transformer training, running Multi-Head Attention (MHA) and MLP on separate CUDA streams enables overlap — while MLP's first matmul runs, attention's compute finishes on a different stream. This is feasible because attention output and MLP input are separate tensors. For inference, the opportunity is narrower (decode attention output is 1 token — too small to meaningfully overlap) but for large-batch decode or prefill, MHA-MLP parallelism on separate streams can improve utilization.

### 3.4 Weight Dequantization Overlap

With Tribunus' weight compression pipeline (ADR 0034), weights arrive on the Metal/GPU lane in compressed form (INT4 block format for dense layers, codebook-quantized for MoE experts, INT8 for sensitive layers). The fused dequantize-matmul kernel loads compressed weights, dequantizes on-the-fly in shared memory or registers, and performs the matmul — there is no separate decompression pass.

The compute image pre-declares which layers use which codec. The decode loop kernel dispatch is:

```
// Per decode token, per layer:
1. [GPU] KV gather from KV ring (memory read, arena lease validated)
2. [GPU] Fused flash attention with KV tensors (mostly memory reads, softmax compute)
3. [GPU] Fused dequantize-matmul for MLP (read compressed weights, dequantize, matmul)
   └─ While attention memory loads complete, weight tiles begin streaming
4. [GPU] RMSNorm (element-wise on attention output, trivially cheap)
5. [GPU] Fused dequantize-matmul for logits projection
6. [CPU/ANE] Logits sampling (greedy/top-k/top-p) — can overlap with next layer's attention start
```

### 3.5 Tribunus-Specific: Unified Memory Eliminates H2D/D2H

Apple Silicon's unified memory means there is **no data copy** between CPU and GPU — the KV cache, activations, and logits all live in the same IOSurface-backed arena. The CPU sampling step reads logits directly from the logits ring without a D2H copy. This removes a major source of latency in discrete GPU systems (typically 10-50 us per copy operation). On NVIDIA, the equivalent requires pinned host memory + explicit cudaMemcpy, though GPUDirect RDMA and NIXL reduce this for multi-GPU.

**Recommendation**: Implement per-layer overlapping execution: while attention for layer N+1 begins (memory-bound reads from KV ring), the MLP weights for layer N+1 are being prefetched from the weight-staging ring. The compiler should schedule weight tile prefetch as a parallel operation — the weight-staging ring has its own DMA engine independent of the compute lane. On Metal, use `MTLIndirectCommandBuffer` to batch kernel dispatches and `MTLFence` for intra-queue synchronization. On NVIDIA, use CUDA streams for weight prefetch overlap.

---

## 4. Speculative Decoding Integration

### 4.1 The Draft-Verify-Commit Loop

Speculative decoding replaces the one-token-per-iteration decode loop with a two-phase loop:

```
Loop:
  1. DRAFT: Draft model (small, fast) proposes K tokens sequentially
     → K draft KV pages written to speculative KV ring
  2. VERIFY: Target model runs one forward pass on K draft tokens in parallel
     → Tree attention mask ensures causal isolation
     → Verifier scores all K positions, accepts the longest prefix matching target distribution
  3. COMMIT: Accepted tokens (0 ≤ h ≤ K) are appended to authoritative KV ring
     → Rejected speculative KV pages are discarded, generations incremented
  4. SKIP: Decode position advances by h tokens (0 ≤ h ≤ K)
     → If h = 0 (all rejected), normal decode produces 1 token
```

The commit step uses **PagedAttention-style copy-on-write block tables**: draft KV pages are provisional. If accepted, the block table pointer is reassigned to the authoritative ring (zero-copy). If rejected, the draft block's generation counter is incremented, making any lease referencing the old generation invalid — any access attempt by a stale handle is immediately caught (ADR 0036 lease validation).

### 4.2 Tree Speculative Decoding (SpecInfer / EAGLE-2)

Instead of a linear chain of K draft tokens, the draft model proposes a **tree**: at each position, the top-B candidate tokens branch. A tree of depth D and width B has up to B^D nodes. The verifier processes the entire tree in one forward pass using a **tree-structured attention mask** — tokens at position i attend only to their ancestors in the tree. The acceptance algorithm walks the tree from root, accepting the longest path where every token matches the target distribution.

Tribunus' compute-image model (ADR 0034) pre-declares tree topology parameters: depth, branching factor, and the candidate selection backend (ANE proposal heads → CPU tree assembly → GPU verifier). The compiler generates tree attention mask patterns as part of the compute image.

### 4.3 EAGLE-3: Draft Heads on Target Model

EAGLE-3 (NVIDIA, 2024-2025) eliminates the separate draft model. Instead, lightweight autoregressive prediction heads are attached to the target model's internal layers. The draft head predicts the next K tokens from intermediate hidden states during the target model's forward pass — there is no separate draft model inference. Acceptance rates reach 85%+ on code and structured text.

This aligns with Tribunus' architecture: the ANE expert proposal fabric (ADR 0034) is effectively EAGLE-style draft heads running on the Neural Engine. The proposal head runs as a **fused heterogeneous region** (ANE MIL program → CPU assembly → GPU verify), not as a separate model load.

### 4.4 How the Decode Pipeline Changes with Speculation Active

When speculation is active, the decode loop changes structurally:

**Without speculation**:
```
[KV gather → attention → MLP → logits → sample] × per_token
```

**With speculation (tree, K tokens drafted)**:
```
[ANE draft: K tokens → CPU tree assembly → GPU verify: K tokens in parallel → commit h tokens → advance h positions]
```

The verifier forward pass is **compute-dense**: it processes K tokens in parallel (like prefill) rather than 1 token (like decode). This changes the GPU kernel profile from memory-bound to compute-bound, improving utilization. The tradeoff is that draft model inference and tree construction add latency. The compiler must decide per-request whether to enable speculation based on:
- Draft model acceptance rate on this domain (code: 80%+, creative writing: 40-60%)
- Current batch size (speculation less beneficial when batch already saturates compute)
- Available ANE bandwidth (proposal fabric may be busy with other requests)
- Thermal headroom (ANE + GPU running simultaneously increases power draw)

### 4.5 KV Ring Isolation Guarantees

Tribunus' typed rings (ADR 0036) provide hardware-enforced isolation:
- **Speculative KV ring** holds draft KV pages
- **Authoritative KV ring** holds committed pages
- Draft pages are **never** visible to the authoritative path until committed
- Rejected draft pages increment their generation counter → any stale lease referencing old generation is invalid
- The verifier writes to the **verifier ring**, not directly to KV rings
- The commit step is an atomic page-table pointer swap (zero-copy)

**Recommendation**: Implement the draft/verify/commit loop as a deterministic state machine over precompiled manifests. The compiler emits: (a) draft kernel + topology parameters, (b) tree attention mask patterns, (c) verifier kernel + acceptance threshold, (d) commit/rollback page operations. The runtime executes: lease speculative pages → submit draft → submit verify → sample acceptance → commit or rollback. No runtime decisions — the compute image has already decided when to speculate, with what topology, and on which backends.

---

## 5. MLX Metal JIT vs Precompiled Kernels: The Tribunus Advantage

### 5.1 MLX's JIT Architecture

MLX operates on a **lazy computation graph** model:
1. Operations build a graph of symbolic array nodes (no computation)
2. `eval()` triggers graph optimization and execution
3. On first execution of a new operation shape, MLX JIT-compiles Metal kernels via `MTLCompileOptions` and caches them in `mlx.metallib`
4. Subsequent calls reuse cached kernels

MLX's built-in `mlx.metallib` contains precompiled kernels for common ops (matmul, add, rms_norm, softmax, etc.). Custom kernels defined via `mx.fast.metal_kernel()` are compiled once and cached. The `mx.compile()` transformation compiles and caches entire computation graphs.

### 5.2 Quantified JIT Overhead

Public benchmarks show:
- **Cold compile cost**: First invocation of a new Metal kernel operation takes 0.16-246 ms depending on kernel complexity. A GELU activation on M1 Max: 15.5 ms uncompiled → 3.1 ms after compilation (5x speedup from caching alone).
- **JIT warmup iterations**: 3-6 iterations needed to reach steady-state performance.
- **Small tensor overhead**: For tensors < 1000 elements, Metal kernel launch overhead (including JIT) can dominate actual compute time.
- **Dynamic shape recompilation**: MLX recompiles kernels when tensor shapes change. In the decode loop, batch size changes (continuous batching) and sequence length growth (KV cache append) trigger recompilation.
- **Metal standard library dependency**: If a kernel references symbols not in `mlx.metallib`, the JIT context fails if the Metal standard library is not available in the JIT path.

### 5.3 Tribunus Compute Image: Zero JIT Overhead

With precompiled compute images, every kernel is compiled offline during assessment (Layer 0). The compute image contains:
- Precompiled `.metallib` bundles for every kernel at every shape the runtime will use
- Pre-qualified batch families — the runtime selects from a fixed set, never invents new shapes
- Kernel-to-buffer bindings pre-resolved — the manifest maps kernel argument indices to arena page IDs
- No `eval()` graph construction — the runtime submits precompiled kernels directly via `MTLComputeCommandEncoder`

The decode hot path is:

```
// Per iteration (Tribunus precompiled):
1. scheduler selects batch family (e.g., batch_size=8, kv_len=2048)
2. arena lease manager validates (page_id, generation) pairs for all inputs
3. indirect command buffer dispatches precompiled kernels:
   a. kv_gather_kernel[batch_8_kv_2048]    // precompiled metallib
   b. flash_attention_kernel[batch_8_kv_2048]
   c. dequantize_matmul_mlp[batch_8_hidden_4096]
   d. rms_norm_kernel[batch_8_hidden_4096]
   e. dequantize_matmul_logits[batch_8_vocab_32000]
4. fence → advance ring state → sample logits
```

No kernel compilation, no graph construction, no shape discovery. The compile-time cost is amortized across all inference sessions on that hardware configuration.

### 5.4 Expected Speedup from Eliminating JIT

The decode loop is the most latency-sensitive path in the system — every microsecond of JIT overhead directly adds to per-token latency. Quantitative estimates:

| Component | MLX JIT Hot Path | Tribunus Precompiled | Savings |
|---|---|---|---|
| Kernel compilation (amortized) | 0.5-5 us per kernel (cached, but shape-check + dispatch) | 0 us (direct dispatch) | ~1-10 us per token |
| Graph construction (lazy eval) | ~5-20 us per `eval()` call | 0 us (manifest-driven) | ~5-20 us per iteration |
| Shape validation / recompilation | Trigger on batch change (1-50 ms per recompile) | 0 us (prequalified families) | Variable, up to 50 ms on batch resize |
| Memory allocation | Dynamic arena growth | Pre-declared leases | 0 allocation time |
| Backend selection | MLX internal dispatch | Manifest-frozen | No dispatch overhead |

For a 7B model on M1 Max (typical decode latency ~15-30 ms per token for batch=1, FP16), removing JIT and graph construction overhead could save **5-25% of per-token latency** (1-8 ms savings). In batch=8 serving scenarios where continuous batching triggers frequent shape changes, the savings from eliminating recompilation could be **significantly higher** — up to 50% reduction in tail latency.

The real Tribunus advantage is **predictability**. MLX JIT introduces variance: a batch-size change causes a one-time recompilation spike, producing a latency outlier. Tribunus precompiled pipelines have no variance — every iteration takes the same wall-clock time for the same batch family, modulo thermal throttling.

**Recommendation**: The Tribunus Metal backend should load all precompiled `.metallib` bundles at session startup (one `MTLLibrary` per batch family). Use `MTLIndirectCommandBuffer` for replay — the indirect command buffer is populated once at session start and replayed every decode iteration. This achieves CUDA Graph-equivalent launch amortization on Apple Silicon. The scheduler selects the active indirect command buffer based on the batch family index; transitioning to a different batch size switches to a different pre-populated indirect command buffer (zero overhead).

---

## 6. Consolidated Recommendations for Tribunus Runtime Decode Pipeline

### 6.1 Scheduling

- Implement iteration-level continuous batching with prequalified batch families (not dynamic shape discovery).
- Use Tribunus' KV ring (ADR 0036) as the KV cache substrate instead of vLLM's block table — the ring already provides generation-counted, branch-aware paging with IOSurface backing for zero-copy interop.
- Support chunked prefill with decode-priority scheduling: decode slots fill first, remaining token budget allocates to prefill chunks.
- Separate scheduler queues: Waiting → Prefill → Decode → Completed. The scheduler runs on Tokio (supervisor), not in the hot path.

### 6.2 Kernel Launch Amortization

- **Apple Silicon**: Pre-populate `MTLIndirectCommandBuffer` per batch family at session start. Replay per iteration. Zero JIT, zero graph construction.
- **NVIDIA**: Emit pre-captured CUDA Graphs per batch family during compute-image compilation. Use graph padding for intermediate sizes. On Blackwell, use conditional WHILE nodes to eliminate bucketing.
- **AMD**: Pre-captured HIP Graphs (equivalent CUDA Graph API on ROCm 6.x).
- **Intel**: Pre-captured Level Zero command lists with immediate submission.

### 6.3 Attention-MLP Scheduling

- Fuse dequantize-matmul for all weight-loaded operations — never materialize decompressed weights.
- On Metal, use `MTLFence` to pipeline: while attention kernel reads KV cache (memory-bound), weight-staging ring prefetches the next layer's compressed weight tiles.
- On NVIDIA, use CUDA streams + events for weight prefetch overlap. The compute image pre-declares the prefetch schedule — the runtime does not decide which weights to prefetch.
- For large-batch decode (batch >= 32), investigate MHA-MLP parallelism on separate Metal compute pipelines / CUDA streams. For batch < 32, the overhead of stream synchronization exceeds the overlap benefit.

### 6.4 Speculative Decode Integration

- Model the draft/verify/commit loop as a deterministic state machine with precompiled kernel manifests.
- Support tree speculation (B branches, D deep) with pre-generated tree attention masks in the compute image.
- Use Tribunus' speculative KV ring with generation counters for zero-copy commit/rollback.
- ANE proposal heads run as fused MIL regions; CPU assembles tree; GPU verifies in one pass.
- Compiler decides per-request whether to speculate based on assessment data (acceptance rate on workload class, thermal budget, ANE availability).

### 6.5 Performance Target

With precompiled compute images on Apple Silicon:
- **Single-stream decode (batch=1)**: Sub-20 ms per token for 7B model, sub-5 ms for 1B draft model
- **Batched decode (batch=8)**: Sub-15 ms per-token latency (amortized across batch), 80+ tokens/sec throughput
- **Speculative decode**: 2-3x throughput increase at batch=1 (typical acceptance rates 60-80%), diminishing returns at high batch sizes
- **No latency variance from JIT** — every iteration for the same batch family has the same wall-clock time (deterministic performance)

---

## References

- vLLM: PagedAttention (SOSP 2023), V1 Architecture (2025) — iteration-level scheduling, chunked prefill, prefix caching
- TensorRT-LLM: CUDA Graph padding, in-flight batching, piecewise graphs, AutoDeploy (2026)
- Sarathi-Serve: Stall-free scheduling with chunked prefills (USENIX 2024)
- POD-Attention: Prefill-decode overlap at GPU SM level (ASPLOS 2025)
- SpecInfer / EAGLE-2 / EAGLE-3: Tree speculative decoding with draft heads on target model
- MLX: Lazy computation graphs, Metal JIT compilation, `mx.compile()` caching
- CUDA 12.4+: Conditional graph nodes (IF/WHILE/SWITCH), Hopper/Blackwell features
- Tribunus ADRs: 0034 (Compiled Inference), 0035 (Model Virtual Memory), 0036 (Arena/Ring/Lease), 0037 (Backend Realization), 0038 (Numerical Governance)
