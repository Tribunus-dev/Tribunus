# Arena-Based Memory Management with Typed Ring Buffers, Page Leases, and Generation Counters

## Research Summary for Tribunus Compute-Image Inference Runtime

**Date:** June 2026  
**Status:** Design research — no code changes  
**Author:** ResearchArena (delegated from Main)

---

## 1. Introduction: The Problem Space

Tribunus is a portable inference compiler targeting Apple Silicon (ANE, MLX Metal, Accelerate). The compiler pre-declares all memory, generates multiple backend candidates per phase, and freezes winners into a compute image. The runtime is a deterministic state machine with Tokio as supervisor. This architecture creates a unique constraint: the runtime must never discover graphs, lazily compile kernels, allocate surprise temporaries, or choose backends during inference.

To make this work, the memory system must satisfy three non-negotiable requirements:

1. **Pre-declaration**: Every buffer must be known at compile time — its size, dtype, alignment, backend compatibility, and residency tier.
2. **Multi-backend authority**: MLX, Core ML, Accelerate, CPU assemble, and the verifier must all access shared pages without a single backend owning tensor truth. ADR 0021 establishes IOSurface as the canonical authority-visible memory foundation.
3. **Speculative isolation**: Draft KV pages must never contaminate authoritative target KV unless accepted. Rejected branches must roll back cleanly with zero-copy semantics.

This research surveys existing systems that solve analogous problems and synthesizes design recommendations for Tribunus.

---

## 2. ArenaPage Abstraction

### 2.1 What Systems Use Typed Arenas

**vLLM PagedAttention** is the closest analog to Tribunus's ArenaPage. It divides the KV cache into fixed-size blocks (typically 16 tokens per block), each a contiguous region of GPU memory storing key and value tensors. These blocks are allocated on demand from a free pool and do not need to be contiguous in physical memory. A per-request block table maps logical block indices to physical block indices, exactly like an OS page table. This eliminates external fragmentation (all blocks are the same size) and confines internal fragmentation to the last block of a sequence. Memory waste drops from 60-80% to under 4%.

Key mechanisms Tribunus should adopt:
- **Fixed-size pages**: Eliminates external fragmentation. Tribunus can use page sizes tuned per ring type (KV pages larger than activation pages, for example).
- **Block table per sequence**: Maps logical positions to physical pages. In Tribunus, this is a ring slot → ArenaPage mapping rather than a sequence → block mapping, but the indirection principle is identical.
- **Reference counting with Copy-on-Write**: When multiple sequences share a prompt prefix, they share physical blocks. A write to a shared block (refcount > 1) triggers a CoW: allocate new block, copy contents, update the writing sequence's block table, decrement the shared block's refcount. This is exactly the mechanism Tribunus needs for speculative KV isolation — draft sequences share authoritative prefix pages until they diverge.
- **Free pool with lazy recycling**: Blocks return to the free pool only when refcount drops to zero, preventing use-after-free.

**Vulkan Memory Allocator (VMA)** by GPUOpen AMD provides complementary patterns. VMA supports custom memory pools with different allocation algorithms. Its linear allocation algorithm creates new allocations sequentially after the last one, never reusing free regions in the middle — ideal for ring-buffer-like patterns where allocations are freed in FIFO order. VMA's defragmentation is user-driven (it tells you which allocations to move; you recreate resources), which is relevant for Tribunus's arena compaction at phase boundaries.

**Apple Metal MTLHeap** provides suballocation and resource aliasing. Multiple resources can share the same heap allocation at different times, reducing total memory footprint. MTLResidencySet lets developers explicitly declare which resources must be GPU-accessible, ahead of time — matching Tribunus's pre-declaration requirement. Metal's unified memory architecture (CPU and GPU share the same physical memory) means an ArenaPage backed by IOSurface with MTLStorageMode.shared is zero-copy across all backends on Apple Silicon.

### 2.2 How Existing Systems Avoid Page Fragmentation

- **vLLM**: Fixed-size blocks eliminate external fragmentation entirely. Internal fragmentation only in the last block.
- **VMA**: Defragmentation moves data to compact allocations, making contiguous memory available. Incremental defragmentation limits per-pass data movement.
- **Tribunus approach**: Because the compiler pre-declares all memory, fragmentation can be solved at compile time. The compiler knows all page sizes and lifetimes. It can pack pages into arena regions optimally, like a static linker packs sections into segments. Runtime defragmentation should be unnecessary — but if it becomes necessary, VMA-style incremental compaction at phase boundaries (when backends release leases) is the pattern.

### 2.3 Design Recommendations for Tribunus ArenaPage

```rust
struct ArenaPage {
    // Physical identity
    ptr: *mut u8,                    // Base pointer (may be IOSurface mapping)
    byte_len: usize,                 // Capacity in bytes
    dtype: DataType,                 // Element type for bounds checking
    alignment: usize,                // Required alignment

    // IOSurface identity (Apple Silicon)
    io_surface_id: Option<IOSurfaceID>,
    io_surface_seed: u32,            // Detects external modification

    // Backend compatibility
    backend_compat: BackendBitmap,   // Which backends can access this page
    storage_mode: StorageMode,       // Shared/Private/Memoryless (Metal)

    // Residency
    residency_tier: ResidencyTier,   // Hot/Warm/Cold/Mandatory
    current_location: Location,      // Where the page actually resides

    // Authority
    lease_count: AtomicU32,          // Number of active leases
    generation: AtomicU64,           // Monotonic generation counter
    state: AtomicU8,                 // PageState enum
}
```

The `backend_compat` bitmap is critical: a page in MTLStorageMode.private is GPU-only; the CPU cannot access it. A page in MTLStorageMode.shared is accessible to all backends. The compiler must not lease a private page to the CPU assemble backend.

---

## 3. RingSlot Abstraction

### 3.1 What Systems Use Ring-Buffer State Machines

**LMAX Disruptor** is the gold standard for high-performance ring buffers. Its design principles map directly to Tribunus's RingSlot state machine:

- **Pre-allocated fixed-size ring**: Eliminates allocation during the hot path. Tribunus's rings are sized at compile time.
- **Two-phase publish**: Producer claims a slot (CAS on sequencer), fills it, then publishes (write barrier). This is exactly the ring slot state flow: free → reserved → writing → written.
- **Sequence Barriers**: Consumers track their position independently. A SequenceBarrier notifies consumers when new events are available and manages dependencies between consumers. In Tribunus, a backend lane waiting on a readable slot is analogous to a consumer waiting on a sequence barrier.
- **Multicast**: All events are visible to all consumers. This maps to Tribunus's multi-backend visibility: multiple backend lanes can read the same page simultaneously (read leases).
- **Consumer dependency graphs**: One consumer can depend on another completing first. This is the verifier waiting on the proposal ring to produce candidates.
- **Backpressure**: If consumers fall behind, producers block when claiming new slots. In Tribunus, if the verifier ring is full, the proposal backend stalls.

**io_uring** (Linux kernel) uses a pair of shared-memory ring buffers: Submission Queue (SQ) and Completion Queue (CQ). The SQ is SPSC: user space produces, kernel consumes. The CQ is the reverse. Head and tail pointers are 32-bit integers that wrap naturally. Memory barriers ensure that writes to ring entries are visible before pointer updates. The "provided buffers" mechanism is a lease pattern: user space registers a buffer pool; the kernel borrows a buffer, uses it for I/O, and returns it via a completion event indicating which buffer was used.

**SPDK NVMe driver** uses per-core queue pairs (each with SQ + CQ) in a shared-nothing model. Each qpair is owned by one thread; no locks, no atomics on the I/O path. Doorbell registers notify the device of new submissions. Polled mode for completions eliminates interrupt latency. Inter-thread communication uses lockless rings for message passing.

### 3.2 Design Recommendations for Tribunus RingSlot

The state machine specified in the design brief is comprehensive. Here is how existing systems validate each state:

| Tribunus State | LMAX Disruptor Analog | io_uring Analog |
|---|---|---|
| free | Available slot (sequence > consumer position) | Free SQ slot |
| reserved | Claimed slot (CAS won, not yet published) | Reserved SQE |
| writing | Producer filling slot | Writing SQE fields |
| written | Published slot (sequence advanced) | SQE ready, tail advanced |
| readable | Available to consumers (sequence barrier released) | — |
| verifying | — | — |
| committed | — | CQE written by kernel |
| recycled | Slot reused (wrapped around) | Slot reused after head advances |

For speculative decoding:

| Tribunus Speculative State | Mechanism |
|---|---|
| draft_reserved | Claim slot in speculative ring (separate ring from authoritative) |
| draft_written | Draft model writes its candidate tokens |
| verifier_visible | Verifier reads candidates; tree attention mask built |
| accepted → committed | Longest accepted prefix promoted to authoritative KV ring |
| rejected → generation_invalidated | Rejected pages: increment generation counter, free to speculative pool |

The key insight from LMAX is that the ring buffer should use power-of-two sizing for fast modulo (bitwise AND on the index).

```rust
struct RingSlot {
    token_index: u32,        // Position in the token sequence
    layer_id: u16,           // Which transformer layer
    phase_id: u16,           // Which compute phase
    branch_id: u32,          // Speculative branch identifier (0 = authoritative)
    sequence_id: u64,        // Global monotonic sequence number
    generation: AtomicU64,   // Generation counter for ABA prevention
    state: AtomicU8,         // RingSlotState
    page_id: Option<PageId>, // Backing ArenaPage, if materialized
}
```

---

## 4. Lease Abstraction

### 4.1 Lock-Free Patterns

**Hazard pointers** (Maged M. Michael, 2004): Each thread maintains a small fixed number of "hazard pointers" — atomic pointers that announce which objects the thread is currently accessing. Before accessing a shared object, a thread publishes its pointer in a hazard pointer. Before reclaiming a retired object, the reclaimer scans all hazard pointers; only objects not referenced by any thread are safe to free. This prevents the ABA problem.

**Epoch-Based Reclamation (EBR)**: The system maintains a global epoch counter. Threads "pin" themselves to the current epoch when entering a critical section. When an object is removed, it goes on a retired list for the current epoch. When all threads have advanced past a given epoch, all objects retired in that epoch can be safely reclaimed. Three epochs are typically maintained: current, previous, and waiting-to-reclaim. EBR is coarser-grained than hazard pointers but has lower per-access overhead.

**RCU (Read-Copy-Update)**: Used heavily in the Linux kernel for read-heavy workloads. Readers access data with zero synchronization overhead. Writers create a copy, modify it, then atomically swap the pointer. Old data is freed only after a grace period (all pre-existing readers have finished). RCU trades strong consistency for scalability — readers may briefly see stale data.

### 4.2 Lease Pattern for Tribunus

The core principle: a backend never receives a raw pointer without a lease contract. The lease encodes:

- **What**: Which ArenaPage(s) the backend may access
- **How**: Read-only, write-only, or read-write
- **When**: The lease has a bounded lifetime (the phase scope)
- **Who**: Which backend lane holds the lease
- **Proof**: Receipt emitted on lease acquisition and release

This is directly analogous to io_uring's provided buffers mechanism, where the kernel "leases" a buffer from a user-space pool and returns it via completion event. The difference is that Tribunus leases are cross-backend (not user/kernel) and carry additional metadata (dtype, alignment, generation).

```rust
struct PageLease {
    page_id: PageId,
    lease_kind: LeaseKind,       // Read, Write, ReadWrite, Scratch, Commit
    backend_lane: BackendLane,   // MLX, CoreML, Accelerate, CPU, Verifier
    generation_at_acquire: u64,  // Snapshot for validation
    phase_scope: PhaseId,        // Bounding phase
    acquired_at: Instant,
    expires_at: Instant,         // Hard deadline after which lease is revoked
}

enum LeaseKind {
    Read,        // Multiple concurrent readers allowed
    Write,       // Exclusive writer (no concurrent readers or writers)
    ReadWrite,   // Exclusive read-write (for in-place operations)
    Scratch,     // Backend-private workspace; no commit required
    Commit,      // Verifier commit lease; transitions page to committed state
}
```

The lease count on ArenaPage (atomic increment on acquire, decrement on release) prevents premature recycling. A page with lease_count > 0 cannot transition to the free state. This is simpler than hazard pointers for Tribunus's use case because lease lifetimes are bounded by phase scopes — no unbounded critical sections.

---

## 5. Typed Rings Inside the Arena

### 5.1 Ring Taxonomy

The eight ring types specified in the design brief each have distinct eviction and correctness rules:

| Ring | Eviction Rule | Correctness Rule | Existing Analog |
|---|---|---|---|
| **KV ring** | LRU + compiler hints | Append-only for authoritative pages; branch-aware (refcount) | vLLM PagedAttention block table |
| **Speculative KV ring** | Immediate on rejection; promote on acceptance | Must never touch authoritative state; isolated page pool | vLLM CoW fork; io_uring provided buffers |
| **Activation ring** | Recycled immediately after fence | Transient — no persistence across phases | Metal MTLStorageMode.memoryless; VMA linear allocator free-at-once |
| **Proposal ring** | Consumed by verifier; then recycled | Write-once by ANE, read-once by CPU assemble | io_uring SQ → CQ pattern |
| **Verifier ring** | Recycled after commit/rollback | Packed tree-verification inputs; read-once by GPU | LMAX Disruptor multicast + barrier |
| **Logits ring** | Compact, fast turnover | Small fixed-size slots; oldest evicted first | Ring buffer with overwrite |
| **Scratch ring** | Backend-private; recycled within phase | Never crosses phase boundary; never authority-visible | SPDK per-core qpair; io_uring provided buffers |
| **Weight-staging ring** | LRU + compiler sticky hints | Decompressed tiles for dynamic expert loading; read-only after staging | vLLM block cache; OS page cache |

### 5.2 Ring Sizing and Layout

Because the compiler pre-declares all memory, ring sizes are determined at compile time. The compiler emits:

- **Ring capacity**: Number of slots (always a power of two)
- **Slot size**: Bytes per slot (may vary by ring type)
- **Backing page size**: ArenaPage allocation granularity for this ring
- **Residency contract**: Which pages are mandatory-resident vs. paged
- **Prefetch strategy**: Sequential for dense layers; router-predicted for MoE (Fate-inspired cross-layer gate prediction at 97.15% accuracy per ADR 0034)

### 5.3 Branch-Aware KV Ring

This is the hardest ring to design. It requires:

1. **Append-heavy workload**: New KV cache entries are always appended (never modified in place for authoritative pages).
2. **Branch isolation**: When a speculative branch is created, it shares all authoritative prefix pages via CoW. The branch gets its own block table that initially points to the same physical pages. On first write to a shared page, CoW triggers.
3. **Acceptance promotion**: When a speculative branch is accepted, its divergent pages are promoted to the authoritative ring. The refcount on shared pages is decremented (the branch no longer references them).
4. **Rejection rollback**: When a speculative branch is rejected, its divergent pages are freed (generation incremented, returned to speculative pool). Shared pages are untouched.

This is exactly vLLM's reference counting + CoW model, extended with generation counters for ABA prevention.

---

## 6. State Machine for Pages

### 6.1 Legal Transitions

The state machine for an ArenaPage (as distinct from a RingSlot) tracks physical memory lifecycle:

```
                    ┌─────────┐
           allocate │  FREE   │ reclaim (refcount==0
           ┌───────▶│         │◀──────  && generation valid)
           │        └────┬────┘
           │             │ lease_acquire
           │        ┌────▼────┐
           │        │ LEASED  │◀────────┐
           │        │(in use) │         │
           │        └────┬────┘         │
           │             │              │
           │    ┌────────┼────────┐     │
           │    │        │        │     │
           │    ▼        ▼        ▼     │
           │ ┌──────┐ ┌──────┐ ┌──────┐ │
           │ │READ  │ │WRITE │ │SCRATCH│ │ lease_release
           │ │ONLY  │ │      │ │      │ │ (refcount→0)
           │ └──┬───┘ └──┬───┘ └──┬───┘ │
           │    │        │        │     │
           │    │   commit (verifier)    │
           │    │        │        │     │
           │    ▼        ▼        ▼     │
           │ ┌──────────────────────┐   │
           │ │     COMMITTED        │───┘
           │ │ (authority-visible)  │
           │ └──────────┬───────────┘
           │            │
           │            │ evict / retire
           │       ┌────▼────┐
           │       │ RETIRED │──▶ generation++
           │       │(pending │    then free
           │       │ reclaim)│
           │       └─────────┘
           │
           └─── CoW fork ──▶ new page allocated
                              (original refcount unchanged)
```

### 6.2 Generation Counters and the ABA Problem

The ABA problem occurs when a page is freed, reallocated, and a stale reference still points to the same memory address. The stale holder sees "same address, must be the same page" — but it's been recycled.

Generation counters prevent this: every ArenaPage carries a monotonic generation number. When a lease is acquired, the lessee records `generation_at_acquire`. Before any access, the lessee validates that `page.generation.load(Ordering::Acquire) == generation_at_acquire`. If the generation has changed, the page was recycled and the lease is stale — the access must be aborted.

For speculative decoding specifically:

1. Draft pages are allocated from the speculative pool with generation `G_draft`.
2. If accepted, the draft page's generation is atomically swapped to the authoritative generation counter value. The page transitions to the authoritative KV ring.
3. If rejected, `page.generation.fetch_add(1, Ordering::Release)` invalidates all outstanding speculative leases. The page is returned to the speculative free pool.
4. Any backend still holding a lease with `generation_at_acquire == G_draft` will fail validation on next access, because the generation has advanced.

This is directly analogous to EBR's epoch-based reclamation: the generation counter partitions time, and a page can only be reused when all observers from the previous generation have dropped their references.

### 6.3 Speculative Isolation Contract

```
┌─────────────────────────────────────────────────────────────┐
│                   AUTHORITATIVE ARENA                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              KV RING (authoritative)                 │   │
│  │  page_0  page_1  page_2  page_3  page_4  page_5    │   │
│  │  [shared prefix — tokens 0-79]                      │   │
│  │              refcount=2 (main seq + draft branch)    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         SPECULATIVE KV RING (isolated)               │   │
│  │  spec_page_0  spec_page_1                           │   │
│  │  [draft-only tokens 80-95] [draft tokens 96-111]    │   │
│  │  generation=G_draft   generation=G_draft             │   │
│  │  ─── NEVER touches authoritative pages ───           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

On acceptance:
  spec_page_0.generation → G_auth   (promoted)
  page_2..page_5 refcount decremented (branch no longer references shared)

On rejection:
  spec_page_0.generation++          (invalidated)
  spec_page_0 → speculative free pool
  page_2..page_5 refcount decremented
```

---

## 7. Known Implementations Summary

### 7.1 vLLM PagedAttention

- **Page table**: Per-sequence block table mapping logical → physical blocks. 64-byte entries.
- **Reference counting**: Blocks are shared across sequences; freed only at refcount zero.
- **Copy-on-Write**: Write to shared block (refcount > 1) triggers allocation + copy + table update.
- **Generation tracking**: Per-block "filled positions" count tracks how many tokens are stored.
- **Free pool**: Global pool of physical blocks; O(1) allocate and free.
- **Waste**: Under 4% memory waste vs. 60-80% for contiguous pre-allocation.

### 7.2 LMAX Disruptor

- **Ring buffer**: Fixed-size, pre-allocated, power-of-two capacity.
- **Slot claiming**: CAS-based for multi-producer; lock-free for single-producer.
- **Two-phase publish**: Claim → fill → publish (write barrier).
- **Sequence barriers**: Per-consumer progress tracking; dependency graphs.
- **Backpressure**: Producers block when ring is full.
- **Cache-friendly**: Contiguous layout; no GC pressure.

### 7.3 io_uring

- **SQ/CQ ring buffers**: Shared memory between user space and kernel.
- **SPSC lock-free**: Single producer, single consumer per queue direction.
- **Head/tail pointers**: 32-bit integers, natural wrap-around.
- **Memory barriers**: Ensure write visibility before pointer updates.
- **Provided buffers**: Lease-like pattern — kernel borrows from registered pool, returns via CQE.
- **Polled mode**: Avoids interrupt latency for low-latency workloads.

### 7.4 SPDK

- **Per-core queue pairs**: Shared-nothing model; no locks on I/O path.
- **Polled completions**: `spdk_nvme_qpair_process_completions()`.
- **Doorbell batching**: Multiple commands before a single doorbell ring.
- **Message passing**: Lockless rings for inter-thread communication.

### 7.5 Apple Metal Memory Model

- **IOSurface**: Kernel-managed, zero-copy cross-process texture memory. The foundation for Tribunus's memory island (ADR 0021).
- **MTLStorageMode.shared**: CPU + GPU accessible; default on Apple Silicon.
- **MTLStorageMode.private**: GPU-only; faster, supports compression.
- **MTLResidencySet**: Explicit residency control — declare ahead of time which resources must be GPU-accessible.
- **MTLHeap**: Suballocation and resource aliasing from a single allocation.

### 7.6 Vulkan VMA

- **Custom pools**: Different allocation strategies per pool.
- **Linear allocator**: Fast, low metadata; ideal for ring buffers and free-at-once patterns.
- **Defragmentation**: User-driven, incremental; moves data to compact allocations.

### 7.7 Hazard Pointers / EBR / RCU

- **Hazard pointers**: Per-node protection; single-writer multi-reader atomic pointers.
- **EBR**: Epoch-based; coarser-grained; generation counter is the core mechanism.
- **RCU**: Read-heavy workloads; zero-overhead reads; grace period for reclamation.

---

## 8. Synthesis: Design Recommendations for Tribunus

### 8.1 Unified Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     COMPUTE IMAGE (precompiled)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Ring Layouts │  │ Page Allocs  │  │ Lease Contracts      │   │
│  │ (8 typed     │  │ (sizes,      │  │ (who accesses what,  │   │
│  │  rings)      │  │  residency)  │  │  when, how)          │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   RUNTIME ARENA (IOSurface-backed)               │
│                                                                  │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │ KV Ring │ │Spec KV   │ │Activ Ring│ │Proposal Ring     │    │
│  │(vLLM    │ │Ring      │ │(VMA      │ │(io_uring SQ→CQ)  │    │
│  │ PagedAtt│ │(CoW fork)│ │ linear)  │ │                  │    │
│  └─────────┘ └──────────┘ └──────────┘ └──────────────────┘    │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │Verif.   │ │Logits    │ │Scratch   │ │Weight-Staging     │    │
│  │Ring     │ │Ring      │ │Ring      │ │Ring               │    │
│  │(LMAX    │ │(overwr.) │ │(SPDK     │ │(page cache)       │    │
│  │ barrier)│ │          │ │ private) │ │                   │    │
│  └─────────┘ └──────────┘ └──────────┘ └──────────────────┘    │
│                                                                  │
│  All pages carry: generation counter, lease_count, state,        │
│  backend_compat bitmap, residency_tier                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND LANES (lease holders)                 │
│                                                                  │
│  ┌────────┐  ┌────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  │
│  │  MLX   │  │Core ML │  │Accelerate│  │  CPU   │  │Verifier│  │
│  │(GPU)   │  │(ANE)   │  │(CPU SIMD)│  │(assmble)│  │(GPU)   │  │
│  └────────┘  └────────┘  └──────────┘  └────────┘  └────────┘  │
│                                                                  │
│  Each lane validates generation counter before every access.     │
│  No lane receives a raw pointer without a lease.                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Page Size Strategy

- **KV pages**: 64 KB (match macOS page size; good for IOSurface alignment). vLLM uses ~16 tokens per block; Tribunus's variable token count per page means per-page "filled slots" tracking.
- **Activation pages**: 16-64 KB, tuned to layer output size. Recycled immediately.
- **Speculative KV pages**: Same size as authoritative KV pages for easy promotion.
- **Scratch pages**: Backend-specific; Accelerate ring buffer pages per ADR 0021.
- **Weight-staging pages**: 64 KB tiles for decompressed weight streaming.

### 8.3 Generation Counter Implementation

Use a 64-bit atomic counter per ArenaPage. On lease acquire, snapshot the counter. On access, validate. On recycle (free → reallocate), increment the counter. This is a well-known pattern from EBR; 64 bits means wraparound is not a concern (at 1 billion recycles per second, it takes 584 years to wrap).

### 8.4 Lock-Free Ring Operations

For single-producer rings (e.g., MLX writes to activation ring, CPU reads): use the io_uring SPSC pattern — head/tail pointers with memory barriers, no atomics on the hot path.

For multi-producer rings (e.g., multiple speculative branches writing to the speculative KV ring): use the LMAX Disruptor multi-producer pattern — CAS on the sequencer to claim slots, then fill and publish.

### 8.5 Lease Lifecycle

1. **Acquire**: Atomic increment `lease_count`. Snapshot `generation`. Record lease in receipt log.
2. **Validate**: Before every access, verify `generation` matches snapshot. If not, the lease is stale — abort.
3. **Use**: Backend reads/writes within the phase scope.
4. **Release**: Atomic decrement `lease_count`. If `lease_count` reaches 0 and state is RETIRED, the page can transition to FREE.
5. **Receipt**: Every lease acquire/release is receipted per ADR 0034 Layer 3.

### 8.6 Integration with Existing Tribunus Architecture

- **ADR 0021** (IOSurface Single-Island): The arena is the IOSurface-backed memory island. ArenaPages are the unit of allocation within that island.
- **ADR 0034** (Compiled Backend Inference): The page layout, ring sizes, and lease contracts are part of the compute image's placement manifest. Nothing is discovered at runtime.
- **ADR 0019** (Compute Kernel): The lease abstraction lives in the Compute Kernel as the mechanism for backend lanes to access shared memory.

### 8.7 Open Questions and Future Work

1. **Page size heterogeneity**: Should all pages within a ring be the same size, or can rings contain mixed-size pages? vLLM uses uniform blocks; VMA supports mixed-size allocations but pays fragmentation cost. Recommendation: uniform pages per ring, different sizes across rings.

2. **CoW granularity**: vLLM copies entire blocks on write. For Tribunus, should CoW operate at the page level or at a finer sub-page granularity? Page-level is simpler and maps to hardware page protection (IOSurface). Sub-page CoW requires software tracking and is probably not worth it for inference workloads.

3. **Ring overflow behavior**: What happens when a ring is full? LMAX blocks producers; io_uring provides CQ overflow protection via linked lists. For Tribunus, blocking is correct for KV and activation rings (you cannot proceed without space). For logits and scratch rings, oldest-first eviction may be acceptable.

4. **NUMA awareness**: Apple Silicon is UMA, so NUMA is not a concern for v1. If Tribunus expands to multi-socket or discrete GPU, page placement hints (similar to VMA's memory type selection) will be needed.

5. **Checkpointing**: Can the arena be snapshotted for fault recovery? The generation counter and lease count are sufficient to reconstruct which pages contain committed state.

---

## 9. References

1. Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention," SOSP 2023. [vLLM paper]
2. Maged M. Michael, "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects," IEEE TPDS 2004.
3. Martin Thompson et al., "LMAX Disruptor: High Performance Inter-Thread Messaging Library," 2011.
4. Jens Axboe, "Efficient IO with io_uring," Linux Kernel Documentation, 2019.
5. Intel, "Storage Performance Development Kit (SPDK): NVMe Driver Design," spdk.io.
6. GPUOpen AMD, "Vulkan Memory Allocator (VMA)," GitHub, 2024.
7. Apple Inc., "Metal Best Practices Guide: Resource Storage Modes," 2025.
8. Apple Inc., "IOSurface Reference," Kernel Framework Documentation.
9. Paul E. McKenney, "Is Parallel Programming Hard, And, If So, What Can You Do About It?" (RCU chapters), 2024.
10. Tribunus ADR 0021: IOSurface Single-Island Runtime with Tokio-Valkey Orchestration.
11. Tribunus ADR 0034: Compiled Backend Inference Architecture.
12. Tribunus ADR 0019: Tribunus Compute Kernel.
13. Tribunus ADR 0035: Model Virtual Memory and Weight Codec.
