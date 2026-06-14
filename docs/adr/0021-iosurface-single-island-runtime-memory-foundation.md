# ADR 0021: IOSurface Single-Island Runtime with Tokio-Valkey Orchestration

## Status

Proposed — June 14, 2026

## Context

Tribunus is moving from backend qualification into device execution on Apple Silicon. The backend coverage lattice can tell us which engines claim a graph family, but it does not establish runtime memory truth. Without a single doctrine, MLX, Core ML, and Accelerate can each become their own memory authority for tensor identity, ownership, layout, synchronization, and copies. The same risk exists at the orchestration layer if phase work can bypass a governed scheduler. For Apple Silicon v1, Tribunus is explicitly not targeting x86, CUDA, ROCm, or generic portability. A platform-specific memory foundation is acceptable if it gives stronger authority and a simpler runtime.

## Decision

Tribunus will use IOSurface as the canonical authority-visible memory foundation for Apple Silicon v1. The runtime will model one memory island, backed by IOSurface surfaces. MLX, Core ML, and Accelerate are execution engines that receive temporary backend views into that island. Tokio is the local async execution scheduler. Valkey Streams is the coordination fabric for recoverable work admission, pending work, reclaim, and cross-process visibility. PGlite remains the durable authority record for receipts and committed state. No backend owns persistent tensor truth. No scheduler owns tensor truth. All authority-visible tensors live in the island. Every phase boundary commits back to the island. Every copy, sync, layout conversion, backend view, work admission, and ack transition is receipted.

The runtime doctrine is:

one runtime memory island
the island is IOSurface-backed
Tokio owns local async execution and phase scopes
Valkey owns work admission, visibility, reclaim, and pending work semantics
PGlite owns durable receipts and committed authority state
all authority-visible tensors live in the island
no backend or scheduler owns persistent tensor truth
backends receive temporary views
backend-private memory is not authority-visible
every phase boundary commits back to the island
every copy, sync, layout conversion, backend view, and orchestration transition is receipted

This deliberately prioritizes runtime truth over peak first-pass performance. The objective is not to prove every framework path is physically zero-copy on day one. The objective is to make copies and control-plane transitions architecturally forbidden by default and receipted whenever a framework or scheduler forces them.

### Terminology

RuntimeIsland: the single IOSurface-backed authority domain for tensor memory.
IslandTensor: a canonical tensor record owned by Tribunus, represented by IOSurface identity plus semantic metadata.
BackendView: a temporary MLX/Core ML/Accelerate view into one or more IslandTensors.
PhaseScope: the bounded execution window during which a backend may read, mutate, or produce tensors.
RuntimeWorkItem: a modeled phase unit that carries work_id, run_id, compute_image_id, phase_id, canonical_phase, backend_target, input_tensor_ids, output_tensor_ids, island_id, budget_class, deadline, retry_policy, cancellation_token, and authority_mode.
Commit: the act of making backend results authority-visible inside the IOSurface island.
SyncEpoch: monotonic synchronization version proving visibility after backend mutation.
HashEpoch: monotonic content-validation version proving tensor content after commit.
CopyLedger: receipt stream recording every copy, attempted zero-copy, layout conversion, and private allocation.
OrchestrationLedger: receipt stream recording work admission, claim, reclaim, ack ordering, cancellation, and dead-letter transitions.

### Policy

The default allowed path is `zero_copy`, `metadata_only_view`, or `layout_reinterpret`. The default disallowed path is `unknown`. A `framework_forced_copy` may be allowed for research and fallback execution, but it is not authority-preferred and must be recorded. A `backend_private_allocation` may exist inside a phase, but it cannot cross the phase boundary as durable truth. It must commit into an `IslandTensor` before the phase can complete.

### Phase Boundary Rule

A canonical inference phase may complete only if all declared outputs are committed `IslandTensor`s, every output has `sync_epoch >= phase.sync_epoch`, every required output has `hash_epoch` recorded or explicitly waived, every backend view has a receipt, every copy has a copy-ledger entry, every runtime work item has an orchestration receipt, and no backend-private tensor escapes the phase scope.

### Orchestration Contract

Tokio owns the local execution runtime. Valkey Streams owns work visibility and recovery. PGlite owns durable receipts. A worker must not claim more Valkey work than it has Tokio permits to execute. Do not acknowledge a Valkey stream entry before the durable receipt commit exists in PGlite. If a worker crashes after backend execution but before ack, recovery can reconcile the committed receipt against the pending work entry and safely reclaim or acknowledge it.

### Engine Roles

MLX is the MLX execution engine for Tribunus. It may retain MLX internals and lazy execution inside a PhaseScope, but no MLX array may become canonical runtime state.

Core ML is a compiled execution engine, not a memory authority. It receives island views, runs legal compiled subgraphs, and commits results back to island tensors.

Accelerate is a kernel library family underneath a Tribunus-owned graph executor. It receives mapped host views derived from IOSurface-backed IslandTensors, or it stages through a private CPU operational ring buffer when direct mapped execution is illegal, inefficient, or alignment-hostile. The ring buffer is backend-private scratch memory, not durable tensor truth. Ingress, egress, layout conversion, and writeback are receipted.

### Accelerate CPU Operational Ring Buffer

Accelerate may use a private CPU ring buffer for execution scratch, tiling, alignment repair, staging, or kernel-friendly packing. The ring buffer may contain packed matrix tiles, aligned temporary rows, transposed or interleaved operands, reduction scratch, softmax scratch, dequantization scratch, and kernel output staging. The ring buffer may not contain durable KV cache truth, canonical phase outputs after phase completion, persistent model weights unless separately governed, authority-visible tensors, or cross-phase backend-owned state. All ring-buffer ingress and egress must be receipted.

### Inference Implication

Canonical inference phases still model embedding, norm, QKV projection, RoPE, attention score, mask, softmax, value aggregation, output projection, MLP, logits, sampling, KV write, KV append, and KV view. The difference is that all phase inputs and outputs are island tensors. Backend execution engines no longer define tensor lifetime or ownership. Every phase is represented as a RuntimeWorkItem before execution.

### MLX Golden Path

For every supported canonical inference phase, Tribunus defines an MLX golden path with declared inputs, declared outputs, declared temporary surfaces, declared operation sequence, declared eval boundary, declared synchronization rule, declared layout expectations, declared copy policy, and declared fallback condition. MLX ambient laziness is not runtime authority. The backend may not improvise a different operation graph at runtime unless it emits a new lowering receipt and the plan is revalidated.

### Validation Rule

If Accelerate reads directly from IOSurface, the view kind is mapped_host_view and the copy classification is zero_copy or metadata_only_view. If Accelerate stages into the ring buffer, the view kind is cpu_ring_buffer_view and the copy classification is host_materialization_copy or layout_transform_copy. If Accelerate writes directly to IOSurface, the output commit is direct_writeback. If Accelerate writes to ring buffer first, the output commit is ring_buffer_writeback_copy. If any transition is unknown, authority_eligible is false.

### Tokio and Valkey State Machine

queued -> claimed -> phase_scope_opened -> backend_view_acquired -> executing -> synchronized -> committed_to_island -> receipt_written -> acknowledged

Failure states include cancel_requested, deadline_exceeded, backend_fault, surface_fault, sync_fault, validation_fault, receipt_commit_failed, ack_failed, reclaimed, and dead_lettered.

## Consequences

### Positive

Tribunus gets one authority-visible tensor memory model for Apple Silicon v1. Tokio, Valkey, and PGlite form an explicit orchestration stack instead of ad hoc async control flow. MLX, Core ML, and Accelerate become execution lanes instead of competing memory authorities. Accelerate now has an explicit, honest CPU fallback path without pretending the ring buffer is durable tensor truth. Copy behavior and orchestration behavior become visible and receipted instead of implicit. Phase boundaries become explicit and auditable. The runtime can prioritize correctness and governance before squeezing out every last zero-copy path.

### Negative

This is not a portable memory doctrine for Linux, Windows, CUDA, ROCm, or generic Rust ML stacks. Some framework paths may require copies or private allocations that are now surfaced and governed. The island model and orchestration stack add runtime and bookkeeping complexity. First-pass performance may be lower than a more permissive backend-owned memory approach.

### Operational Impact

Future compute-native work should treat IOSurface-backed island tensors as the default truth model for Apple Silicon v1. Backend adapters should translate into temporary views, execute inside PhaseScope, and commit results back to the island with receipts. MLX implementations must follow pre-modeled golden paths rather than ambient lazy graphs crossing a phase boundary. Workers must not over-claim Valkey work beyond available Tokio permits, and no stream entry may be acknowledged before the corresponding PGlite receipt exists.
