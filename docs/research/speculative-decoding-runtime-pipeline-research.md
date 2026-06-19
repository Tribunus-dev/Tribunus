# Research: Speculative Decoding Runtime Pipeline Patterns

## Status
Research Report — June 2026

## Purpose

Research industry-leading speculative decoding runtime pipeline patterns for Tribunus's inference compiler. Tribunus features tree speculation with 8 MoE proposal heads (Expert Proposal Fabric) running on the Apple Neural Engine (ANE), CPU-side tree assembly, GPU verifier execution, and speculative KV commit/rollback. This is a multi-device pipeline (ANE→CPU→GPU) unique to Tribunus. This report surveys production patterns from vLLM, SGLang/EAGLE-2, Medusa, and SpecInfer and synthesizes recommendations.

---

## 1. Tree Speculation in Production Systems

### 1.1 SpecInfer (CMU, 2023)

SpecInfer introduced token-tree verification as the foundational pattern. A pool of collectively boost-tuned Small Speculative Models (SSMs) predict candidate token sequences. These are organized into a token tree — each node represents a potential token sequence, with shared prefixes forming a trie. The target LLM verifies *all* candidate token sequences simultaneously in a single decoding step via a generalized tree attention mechanism that capitalizes on common prefixes. Acceptance follows the "longest prefix" rule: the system accepts the longest prefix of the speculated tree that matches the LLM's output distribution.

Key architectural insight: the verification pass runs once — not per-branch — exploiting the shared prefix structure so that attention for earlier tokens in the prefix is computed only once and reused across branches.

### 1.2 Medusa (Together AI, 2023)

Medusa co-locates the draft mechanism inside the target model by adding K additional decoding heads to the last hidden state layer. Each head k predicts token at position t+k+1. These are single-layer feed-forward networks with residual connections. For each head k, the top-s_k candidates are selected, forming a tree of candidate continuations.

Medusa's key runtime pattern: the draft heads produce proposals in *one forward pass* of the target model's backbone — there is no separate draft model invocation. The tree attention mask then verifies all candidates in the same pass. This is crucially different from two-model speculative decoding (draft+target) — it is a *single-model, head-augmented* pattern.

- Medusa-1 (frozen backbone): 2.2x speedup
- Medusa-2 (joint fine-tune): 2.3x–3.6x speedup
- ~5 heads recommended for best speedup/quality balance
- Hydra++ extends head depth achieving 1.31x over Medusa

### 1.3 EAGLE-2 / EAGLE-3 (SGLang, 2024-2025)

EAGLE-2 introduces dynamic draft tree construction based on draft model confidence scores. The pipeline has two phases:

1. **Expansion**: The draft model inputs the most promising nodes from the current tree layer to form the next layer, guided by confidence scores. Branching factor controlled by `speculative_eagle_topk`; depth controlled by `speculative_num_steps`.
2. **Reranking**: Tokens with higher acceptance probabilities are selected from the expanded tree to form the final draft sent to the target LLM for verification.

EAGLE-2's context-aware dynamic draft tree adjusts structure based on the *current context* — acceptance rates are context-dependent, not position-dependent. This achieves an average acceptance length of ~4-5.5 tokens per drafting-verification cycle, roughly twice that of standard speculative sampling and Medusa.

EAGLE-3 further refines: replaces feature-level drafting with direct token prediction, introduces multi-layer feature fusion, and plugs a lightweight draft head *directly into the target model* rather than using a separate draft model. EAGLE-3 achieves up to 6.47x speedup, ~1.4x over EAGLE-2.

SGLang's implementation achieves 244 tokens/s on LLaMA-3.1-8B (vs 158 without speculation) — a 3.05x–4.26x speedup range.

### 1.4 vLLM Tree Attention Proposal (2025)

vLLM's May 2025 proposal formalizes tree-attention-based speculative decoding with these components:

- **Token Tree Proposer**: Builds token tree with configurable depth/width, generates topology-aware attention masks
- **Tree-Aware Scorer**: Modified FlashAttention kernel supporting topology-aware attention, enabling parallel tree scoring in a single kernel call
- **Token Tree Management**: Tracks parent-child links, path indices, accepted branches — supports batched inference and dynamic tree expansion
- **KV Cache**: Enhanced with prefix reuse (reference sharing) and delta KV caching
- **Runtime API**: Dedicated tree-based proposal API

### 1.5 Tree Width vs Depth: Empirical Results

The relationship between tree structure and acceptance rate is nuanced:

- **SEQUOIA (NeurIPS 2024)**: Dynamic programming to find optimal tree structures maximizing expected generated tokens. Optimized trees generate 33% more tokens than 16 independent sequences (for tree size 512).
- **OPT-Tree (2024)**: Adaptive draft tree construction maximizing expected acceptance length. Achieves up to 3.2x speedup, generates 10+ tokens in a single step with strong draft model.
- **Dynamic Depth Decoding (2025)**: Uses draft model confidence to dynamically decide when to stop drafting, extending EAGLE-2's average speedup by 44% (to 3.16x average).
- **Acceptance degrades with depth**: Self-speculation methods (Medusa, EAGLE) show "meaningfully degraded" acceptance as tree depth increases — tokens further from the prefix are less likely to be accepted. This motivates shallow-but-wide trees where draft accuracy permits.
- **Task dependency**: Task type is a stronger predictor of acceptance rate than tree depth. Chat domains achieve >1.0 expected accepted length per step even with high entropy due to RLHF-induced lexical predictability. Code/math domains show lower acceptance.
- **~5 heads is the pragmatic sweet spot** for Medusa-style single-model speculation. Beyond ~8, diminishing returns set in as marginal accepted tokens per added head decline.

---

## 2. Draft Model Execution

### 2.1 Colocation Patterns

| Pattern | Draft Location | Target Location | Latency | GPU Memory | Example |
|---------|---------------|-----------------|---------|------------|---------|
| Same GPU, time-multiplexed | GPU | GPU | +draft overhead | Shared | Standard vLLM |
| Same GPU, separate CUDA stream | GPU (stream 2) | GPU (stream 1) | Overlapped | Shared | vLLM w/ streams |
| Separate GPU | GPU 2 | GPU 1 | +PCIe, but parallel | Separate | SpecInfer w/ SSMs |
| CPU | CPU | GPU | +PCIe copy | Separate | CPU draft |
| Co-located heads | Same model | Same model | Near-zero extra | Shared | Medusa, EAGLE-3 |
| ANE coprocessor | ANE | GPU | +dispatch (~200us) | Unified memory | Tribunus |

### 2.2 Tribunus Pattern: ANE Coprocessor Drafting

Tribunus's Expert Proposal Fabric uses 8 lightweight proposal heads running on the ANE — a pattern closest to Medusa/EAGLE-3 (heads inside the target model) but with the heads physically on a different execution unit. The key differences from standard patterns:

1. **Draft is cheaper than target**: 8 proposal heads on ANE produce candidate trees at ~200 µs dispatch + ~25 ns compute. The GPU target model verifier consumes the tree in one batched forward pass. Compared to a two-model pipeline where the draft is a smaller LLM (1-10B params), Tribunus's draft cost is negligible.
2. **Unified memory eliminates copy overhead**: On Apple Silicon, the ANE, GPU, and CPU share the same physical memory. Hidden states written by the GPU are immediately readable by the ANE without PCIe copy. Proposal outputs written by the ANE are immediately readable by the CPU assembler and GPU verifier.
3. **Asynchronous overlap**: The ANE proposal can overlap with the tail of the GPU's previous layer computation. The CPU tree assembly can overlap with GPU attention computation. This is a 3-stage pipeline where each stage can be partially overlapped.

### 2.3 Latency Tradeoff Analysis

For Tribunus on Apple Silicon (assume ~1.5 ms per MoE layer on GPU):

| Operation | Time | Overlaps With |
|-----------|------|---------------|
| ANE proposal heads (8 heads × ~200 µs) | ~200-400 µs | GPU layer i tail |
| CPU tree assembly + mask construction | ~50-100 µs | GPU attention end |
| GPU verifier forward pass (target model) | ~1.5 ms | (blocking) |
| CPU acceptance/rollback decision | ~10-50 µs | GPU verifier tail |
| KV commit/rollback (speculative KV ring) | ~10-50 µs | Between passes |

Total per-cycle overhead of drafting is ~300-500 µs against a ~1.5 ms target forward pass. If acceptance rate is >50% (accepting ~4 tokens per 5 drafted), the per-token latency drops from ~1.5 ms (no speculation) to ~0.4 ms (~3.75x speedup). This is comparable to vLLM's reported 3.05x–4.26x range.

---

## 3. Tree Attention Mask Construction

### 3.1 The Problem

When verifying a candidate token tree, each node must attend only to its *ancestor path* — not to tokens in sibling branches. A naive approach of separate forward passes per branch loses prefix sharing benefits. The solution is to pack the entire tree into a single batched forward pass with a custom attention mask that encodes the tree topology.

### 3.2 Mask Construction Algorithm

The tree attention mask M has dimensions [N, N] where N is the total number of tokens in the unrolled tree (including the prompt prefix). For each pair (i, j):

- M[i, j] = 0 if token j is an ancestor of token i (or j ≤ prefix_length, i.e., in the shared prefix)
- M[i, j] = -inf otherwise

The construction algorithm:

```
1. Flatten the tree into a linear sequence via depth-first traversal
2. Assign each node a position ID = its depth in the tree
3. Construct the ancestor matrix:
   - For i in 0..N-1, for j in 0..N-1:
     - M[i][j] = 0 if is_ancestor(j, i) else -inf
4. The ancestor relation is transitive: if j is an ancestor of i's parent, j is an ancestor of i
```

**Efficient construction**: The ancestor matrix can be built in O(N^2) but N is small (typically 16-64 tokens for a tree of depth 4 and width 4). The matrix is typically constructed on CPU as a boolean or bfloat16 tensor and uploaded to the GPU as part of the verifier input.

### 3.3 Overhead Analysis

- **Mask size**: For N=64 tokens, an [64, 64] bfloat16 mask = 8 KB. Negligible.
- **Construction cost**: O(N^2) boolean operations = negligible (~microseconds on CPU).
- **Kernel impact**: The tree attention mask modifies the standard causal mask. In FlashAttention, this requires a custom variable-length path or a mask-aware kernel. The vLLM 2025 proposal specifically calls for modifying FlashAttention to support topology-aware attention. The overhead vs a standard causal mask is typically <5% for the attention computation due to the mask being pre-computed and applied as a bias.
- **Position ID assignment**: Each node in the flattened tree receives a `position_id` based on its depth in the tree. This is critical for RoPE positional encoding — sibling nodes at the same depth receive the same position_id, while nodes deeper in a branch receive larger position_ids. The position_id assignment must be consistent with the attention mask: a node at depth d can only attend to nodes at depth ≤ d.

### 3.4 Tribunus-Specific Optimization

On Apple Silicon with unified memory, the tree attention mask is constructed on CPU (from the ANE proposal output) and is directly accessible by the GPU verifier without an explicit upload — just a pointer handoff. The iOSurface-backed arena pages (ADR 0036) mean both the CPU assembler and GPU verifier map the same physical memory for the mask, position_ids, and token IDs.

---

## 4. Speculative Acceptance and Rollback

### 4.1 Acceptance Algorithm

The standard speculative acceptance algorithm (Chen et al., 2023; Leviathan et al., 2023) with tree extension:

1. Target model produces logits p_target for each position in the verifier batch
2. For each draft token at position i, compare p_target(token_i) with p_draft(token_i):
   - Sample a random u ~ Uniform(0, 1)
   - Accept token_i if u < p_target(token_i) / p_draft(token_i)
   - Reject token_i (and all descendants in its subtree) otherwise
3. After rejection, generate a bonus token from the residual distribution at the rejection point:
   - p_residual = normalize(max(0, p_target - p_draft))
   - Sample bonus token from p_residual
4. Accepted tokens + bonus token = output for this step

### 4.2 Branch Selection in Tree Speculation

When multiple branches are accepted simultaneously (common in tree speculation), the system must choose *which* accepted branch to commit:

**Longest accepted prefix (SpecInfer, Medusa)**: The primary criterion is maximizing accepted length. Among branches with equal length, tie-breaking favors the branch with the highest cumulative acceptance probability (product of per-token acceptance ratios).

**Highest aggregate score (SEQUOIA, OPT-Tree)**: More sophisticated systems weight branches by their *expected* contribution to total accepted length, accounting for the probability that later tokens in the branch get rejected. This is formalized as maximizing E[accepted_length | tree_structure].

**Dynamic confidence gating (EAGLE-2, DDD)**: The draft model's confidence scores guide both which nodes to expand *and* which branch to prefer at acceptance time. Higher-confidence branches receive priority.

### 4.3 Rollback Mechanism

When rejection occurs, the KV cache must be rolled back to the state before the rejected tokens. Production patterns:

**Traditional (vLLM, standard)**: The full KV cache is written during verification. On rejection, the KV cache entries for rejected tokens are explicitly invalidated by rewinding a page table pointer. This is O(1) in PagedAttention — the page table entry count is decremented, and rejected pages are freed.

**Transactional (TransKV, 2025)**: Speculative KV writes remain *uncommitted* until acceptance is confirmed. Only the accepted prefix is committed to the paged cache. Rejected KV is discarded without a formal rollback — it was never committed. This reduces speculative KV pressure and improves concurrency.

**Tribunus pattern (ADR 0036 Speculative KV Ring)**: The Arena/Ring/Lease architecture provides dedicated speculative KV pages in the Speculative KV ring. Rejected branches increment the generation counter, invalidating all leases to the rejected pages. Accepted KV is promoted to the authoritative KV ring via a `generation_increment` on the authoritative pages. The state machine ensures:
- `draft_reserved → draft_written → verifier_visible → accepted/rejected → generation_invalidated`

This is provably safe: a stale lease (page_id, generation) fails validation if the generation was incremented due to rejection. No explicit rollback of data — just a generation counter update that makes future accesses to rejected pages fail validation.

### 4.4 Acceptance Rate Regimes

| Regime | Per-Step Tokens | Useful? | Speedup | Requires |
|--------|----------------|---------|---------|----------|
| <40% acceptance | <2 tokens | Marginal/negative | <1.5x | Better draft model needed |
| 40-60% | 2-3 tokens | Acceptable | 1.5x-2.5x | Viable for chat domains |
| 60-80% | 3-5 tokens | Good | 2.5x-4x | EAGLE-2 range |
| >80% | 5-8 tokens | Excellent | 4x-6x | EAGLE-3 range |

EAGLE-2 achieves ~4-5.5 tokens accepted per cycle (roughly 60-80% on 7-8 token drafts). EAGLE-3 pushes to ~5-8 tokens. Medusa achieves ~2.5-4 tokens. Standard two-model speculative decoding is typically 2-3 tokens.

---

## 5. Tribunus Multi-Device Pipeline Architecture

### 5.1 Pipeline Stages

The Tribunus speculative decoding runtime orchestrates four stages across three devices:

```
┌──────────┐    proposal    ┌──────────┐    tree + mask    ┌──────────┐
│   ANE    │ ─────────────→ │   CPU    │ ────────────────→ │   GPU    │
│ (CoreML) │  expert logits │ (Tokio)  │   packed batch   │ (Metal)  │
│          │  candidate IDs │          │   attention mask │          │
│ ~200 µs  │                │ ~50 µs   │   position IDs   │ ~1.5 ms  │
└──────────┘                └──────────┘                   └─────┬────┘
                                                                 │
                                                          logits │
                                                                 ▼
┌──────────┐    commit/rollback   ┌──────────┐
│   CPU    │ ◄────────────────── │   GPU    │
│ (Tokio)  │   accepted tokens   │ (Metal)  │
│          │   generation bump   │          │
│ ~10 µs   │                      │          │
└──────────┘                      └──────────┘
```

### 5.2 Device Synchronization Points

On Apple Silicon, synchronization between ANE, CPU, and GPU relies on the unified memory model and Metal's event/semaphore primitives:

**S1: ANE → CPU (Proposal Ready)**
The ANE writes proposal outputs (expert logits, candidate token IDs, confidence scores) to the Proposal Ring (typed ring 4 in ADR 0036). The ANE signals completion via:
- Core ML completion handler (high-level) or
- `_ANESharedSignalEvent` (low-level, private API)
The CPU (Tokio supervisor) polls or waits on this signal. On Apple Silicon unified memory, no data copy is needed — the CPU reads directly from the same physical pages.

**S2: CPU → GPU (Tree Assembly Complete)**
After the CPU assembles the candidate tree and constructs the tree attention mask, it writes the packed batch to the Verifier Ring (typed ring 5):
- Token IDs for each tree node
- Position IDs (tree-depth based)
- Attention mask (boolean bfloat16 matrix)
- Page table entries for speculative KV pages

The CPU signals the GPU via `MTLSharedEvent.signal(value)` and the GPU command buffer encodes `waitForEvent(value)` before the verifier forward pass begins.

**S3: GPU Verifier → CPU Acceptance (Verification Complete)**
The GPU runs the target model forward pass on the packed tree batch. Logits are written to the Logits Ring (typed ring 6). The GPU signals completion via `MTLSharedEvent`. The CPU reads logits, runs acceptance sampling, and decides which branch to commit.

**S4: Commit or Rollback**
- **Commit path**: Accepted speculative KV pages in the Speculative KV Ring are promoted to the Authoritative KV Ring. The generation counter on the authoritative pages is incremented.
- **Rollback path**: Rejected speculative KV pages' generation counters are incremented in the Speculative KV Ring, invalidating any outstanding leases. The verifier's bonus token KV is written directly to the Authoritative KV Ring (not speculative — it's the confirmed token).

### 5.3 Pipeline Staging: Overlap Opportunities

The pipeline can be staged for maximum overlap:

```
Time →
GPU:    [Layer i FFN] [Layer i+1 Attn] [Layer i+1 FFN]
ANE:        [Propose i+1]                  [Propose i+2]
CPU:          [Assemble i+1]  [Accept i]   [Assemble i+2]
Sched:     [Prefetch i+1 experts]
```

Key overlaps:
- **ANE proposal for step i+1 overlaps with GPU layer i FFN** (200 µs < 1 ms FFN time)
- **CPU tree assembly for step i+1 overlaps with GPU layer i attention** (50 µs < 0.5 ms attention time)
- **Expert prefetch based on ANE proposal overlaps with GPU compute** (NVMe read overlapping with GPU execution)
- **Acceptance decision + KV commit overlaps with GPU beginning of next layer**

### 5.4 Backpressure and Adaptive Behavior

ADR 0036 defines explicit backpressure across the typed rings:
- **Verifier Ring full** → ANE stops proposing (backpressure propagates upstream)
- **Weight-staging Ring full** → disk prefetch stops
- **GPU behind schedule** → proposal width dynamically shrinks (fewer candidates per tree node)
- **Thermal/memory pressure** → narrower schedule selected from precompiled manifest variants

The runtime can select from multiple precompiled speculation manifests:
- `spec_aggressive`: 8 heads, depth 4, width 4 (max 64 candidates, ~400 µs ANE time)
- `spec_moderate`: 5 heads, depth 3, width 3 (~135 candidates max, but pruned to top 16)
- `spec_conservative`: 3 heads, depth 2, width 2 (no tree, just flat speculation)
- `spec_off`: No speculation, autoregressive decode

The selection is made per-step based on recent acceptance rate, thermal state, and ring occupancy.

### 5.5 Recommendations for Tribunus Runtime

1. **Use the Transactional KV pattern** (ADR 0036 already supports this via generation counters on the Speculative KV Ring). Never commit speculative KV to authoritative storage until acceptance is confirmed. This eliminates explicit rollback operations.

2. **Adopt the EAGLE-2/3 head-augmented pattern**: The Expert Proposal Fabric's 8 heads on ANE already follows this pattern. The critical runtime detail is feeding the *target model's hidden state* (not a separate draft model's state) as input to the proposal heads — this is what enables single-model, head-augmented drafting with >60% acceptance rates.

3. **Use dynamic tree depth based on confidence**: Rather than a fixed-depth tree, let the CPU assembler prune low-confidence branches during assembly. A confidence threshold of ~0.3 (on softmax probability) is a reasonable starting point — branches below this threshold are not expanded further. This mirrors the rernking phase in EAGLE-2.

4. **Prefer wide over deep for tree structure**: Empirical evidence across SpecInfer, SEQUOIA, and OPT-Tree consistently shows that wider, shallower trees outperform deeper, narrower ones for a given node budget. Start with depth 3, width 4 (max 21 nodes if fully expanded) and tune width upward before increasing depth.

5. **Synchronization primitives**: Use MTLSharedEvent for GPU↔CPU synchronization (verifier ready, acceptance complete). Use _ANESharedSignalEvent or Core ML completion handlers for ANE↔CPU synchronization. Use IOSurface-backed arena pages for zero-copy data sharing across all three devices.

6. **First token is special**: The first speculative step after prefill has no draft history — the first batch of proposals must be produced from the prefill hidden state alone. This is the highest-uncertainty step. Consider a wider tree (more candidates) on the first speculative step to compensate, since draft confidence is lowest when there is no preceding draft history.

7. **Monitor acceptance rate per layer**: The compiler should emit receipt fields tracking per-layer acceptance rate (not just per-step). This enables the runtime to detect layers where speculation consistently fails (e.g., layers with branching-heavy content) and narrow the speculation width at those layers specifically.

---

## 6. References

- Leviathan et al., "Fast Inference from Transformers via Speculative Decoding," ICML 2023
- Chen et al., "Accelerating Large Language Model Decoding with Speculative Sampling," 2023
- Miao et al., "SpecInfer: Accelerating Large Language Model Serving with Tree-based Speculative Inference and Verification," ASPLOS 2024
- Cai et al., "Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads," ICML 2024
- Li et al., "EAGLE-2: Faster Inference of Language Models with Dynamic Draft Trees," 2024
- Li et al., "EAGLE-3: Scaling Up Inference Acceleration of Large Language Models," 2025
- Kim et al., "SEQUOIA: Scalable, Robust, and Hardware-Aware Speculative Decoding," NeurIPS 2024
- Wang et al., "OPT-Tree: Speculative Decoding with Adaptive Draft Tree Structures," 2024
- Tribunus ADR 0034: Compiled Inference Model
- Tribunus ADR 0035: Expert Routing Prediction Research
- Tribunus ADR 0036: Arena, Ring, and Lease Runtime Architecture
