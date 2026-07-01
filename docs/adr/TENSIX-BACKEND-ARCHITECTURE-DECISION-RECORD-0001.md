# ADR 0001: TENSIX-COMPUTEIMAGE Backend Architecture Decisions

## Status
Accepted

## Context
The TENSIX-COMPUTEIMAGE project requires a robust, scalable, and verifiable architecture to run inference and compute workloads on Tenstorrent's Tensix and Blackhole/Wormhole hardware architectures. To prevent knowledge loss across sessions and establish clear contracts, this ADR documents key architectural decisions regarding compilation, admission, memory, scheduling, and runtime orchestration.

---

## 1. Tensix Lowering as a Separate IR Phase

### Decision
Tensix lowering is implemented as a distinct intermediate representation (IR) phase (`TensixScheduleIR`) rather than making inline, direct TT-Metalium C++ API calls during compilation.

### Alternatives Considered
- **Inline TT-Metalium Calls**: Direct calls to `tt_metal::CreateProgram`, `CreateKernel`, etc. during the construction of the model graph.
- **On-the-fly execution**: Directly translating PyTorch/ONNX-like eager ops to Metalium without an intermediate representation.

### Rationale
A separate target-lowering layer (`TensixScheduleIR`) enables the representation of Tensix hardware concepts—such as tile geometry, core partitioning, RISC-V roles, circular buffer (CB) allocations, DRAM sharding, NoC routing, and data formats—in a strictly serializable, deterministic, and hashable manner. This creates a backend-neutral representation that can be statically verified, cached, and analyzed without requiring live pointers to TT-Metalium runtime objects. It also prevents the compiler from being tightly coupled to the C++ runtime's memory state, enabling better error boundaries and deterministic artifact generation.

### Deferred Work
- Enhanced optimization passes over the IR for deeper operator fusion.
- Standardizing the IR schema for multi-architecture (Grayskull vs. Wormhole) variations.

---

## 2. Artifact Admission State Machine and Separation of Admission from Compilation

### Decision
The artifact admission process is governed by a strict state machine, fundamentally separating compilation from execution admission.

### Alternatives Considered
- **Compile-and-Run**: Treating compilation outputs as implicitly executable without a formal admission check.
- **Just-In-Time Verification**: Validating artifacts directly inside the execution scheduler at runtime.

### Rationale
Artifacts must pass through a strict lifecycle pipeline (`Unadmitted` -> `Validated` -> `Admitted`). Admission enforces structural validity, signature verification, hardware capability matching (via `CapabilityProbe`), and deterministic caching. By separating admission from compilation, we ensure that an artifact built on one node can be safely validated and run on another. This quarantine phase ensures bad, incompatible, or unsupported payloads (e.g., mismatched Tensor layouts or unsupported architectures) are rejected before they ever reach the execution scheduler, preventing runtime crashes and silent corruption.

### Deferred Work
- Network-level artifact attestation and signed manifests.
- Fine-grained granular capability downgrades during admission.

---

## 3. Mesh Topology Model (1x1 Mesh Identical to NxM Mesh)

### Decision
The mesh topology model enforces that a single device (1x1 mesh) utilizes the exact same code paths, coordination primitives, and execution queues as multi-device (NxM) deployments.

### Alternatives Considered
- **Separate Single-Device Fast Path**: A dedicated, simpler code path for single-device execution to minimize overhead.
- **Host-Centric Dispatch for 1x1**: Dispatching kernels directly from host memory for single devices while using device-to-device NoC for multi-device setups.

### Rationale
Maintaining separate execution paths for single and multi-device setups introduces significant maintenance burden, testing complexity, and edge-case bugs. By treating a single device as a 1x1 distributed mesh, we unify the pipeline, scheduling, event synchronization (`mesh_event.hpp`), and placement planning. It simplifies testing, guarantees that distributed logic is constantly exercised, and ensures seamless scaling from an individual consumer GPU to a datacenter cluster.

### Deferred Work
- Optimizing overhead in the 1x1 mesh case to match single-device fast paths natively.
- Extending mesh support for dynamic re-routing around faulty chips.

---

## 4. Opaque `ResidencyHandle` for Weight Handles

### Decision
Weight handles are modeled using an opaque `ResidencyHandle` type rather than passing raw buffer IDs or host pointers across boundaries.

### Alternatives Considered
- **Raw Buffer IDs**: Passing integer IDs representing physical memory buffers.
- **Direct Memory Pointers**: Using raw memory addresses inside the device.

### Rationale
Using raw buffer IDs or pointers tightly couples the compute kernel to host-side memory allocation and leaks the physical layout to the execution graph. `ResidencyHandle`s provide a safe, abstract binding contract. The matmul artifacts declare required weight tensor IDs, and the weight loader resolves these into `ResidencyHandle`s during the `DeviceWeightResidency` and `MatmulProvider` phases. This ensures kernel code correctly references device addresses while remaining independent of host paths, lifecycle changes, or physical memory fragmentation.

### Deferred Work
- LRU caching and eviction strategies tied to `ResidencyHandle` lifecycles.
- Asynchronous weight streaming behind opaque handles.

---

## 5. KV Cache Ownership Model (SingleDevice, HeadSharded, SequenceSharded)

### Decision
The KV Cache runtime implements an explicit ownership model that defines specific memory distribution strategies: `SingleDevice`, `HeadSharded`, and `SequenceSharded`.

### Alternatives Considered
- **Monolithic KV Cache**: Keeping the entire KV cache on a single device, restricting sequence length.
- **Implicit Sharding**: Automatically distributing KV cache under the hood without exposing the strategy to the provider.

### Rationale
Explicitly modeling KV Cache distribution allows the runtime and memory planner to accurately account for physical capacity, memory bandwidth, and NoC constraints. 
- `SingleDevice` is used for 1x1 execution.
- `HeadSharded` splits attention heads across devices, ensuring independent parallel compute.
- `SequenceSharded` (e.g., ring attention) splits tokens across devices for infinitely scalable sequence lengths.
This structured ownership aligns with the `TensixMemoryPlanner` and `TensixBlockTableContract`, enabling deterministic allocation and precise invalidation/rollback during generation resets or sequence preemption.

### Deferred Work
- Dynamic swapping of KV cache blocks to/from CPU RAM via DMA.
- Advanced KV cache compression formats (e.g., Block Floating Point variants).

---

## 6. Provider Substitution Pattern (Single-Core Default, Multi-Core Upgrade)

### Decision
The system uses a provider substitution pattern where single-core kernel variants are the default fallback, with multi-core implementations deployed as "upgrades" during the lowering and planning phases.

### Alternatives Considered
- **Always Multi-Core**: Requiring all kernels to be multi-core aware, leading to complexity for simple operations.
- **Static Dispatch**: Hardcoding multi-core variants for specific operators without a generic substitution mechanism.

### Rationale
Starting with single-core defaults ensures a highly reliable, easily testable baseline (serving as a numerical conformance baseline against CPU references). Multi-core upgrades are seamlessly swapped in by the `TensixPlacementPlan` when the capability probe and placement map justify it. This allows progressive enhancement of the compute graph and ensures robust fallback if an upgraded provider cannot fit within the remaining L1/DRAM capacity constraints.

### Deferred Work
- Heuristic-based automatic autotuning of core grid sizes during provider substitution.
- Fine-grained core reallocation dynamically during execution.

---

## 7. Dynamic Shapes via `ShapePolymorphism`

### Decision
Dynamic shapes are supported through a dedicated `ShapePolymorphism` class rather than generating individual, per-shape artifacts.

### Alternatives Considered
- **JIT Per-Shape Compilation**: Recompiling artifacts whenever a new shape is encountered.
- **Bucketized Shape Artifacts**: Pre-compiling a fixed set of artifacts for bucketed sequence lengths.

### Rationale
Generating new artifacts per shape leads to combinatoric explosion, massive compilation times, and cache thrashing. The `ShapePolymorphism` approach parameterizes critical loop boundaries and memory offsets within the artifact's execution plan, making the artifact shape-agnostic for bounds up to a maximum limit. This is crucial for operations like autoregressive decode where sequence length grows step-by-step, allowing the same artifact to be executed repeatedly with updated symbolic shape variables without touching the AOT compiler.

### Deferred Work
- Full integration with symbolic shape solvers for all operator classes.
- Zero-padding optimizations for heavily misaligned dynamic shapes.

---

## 8. Lifecycle Pipeline and `AdmittedExecutionPlan`

### Decision
The execution lifecycle pipeline is built as a strict state machine, ensuring the hardware scheduler only ever receives an `AdmittedExecutionPlan`.

### Alternatives Considered
- **Direct Scheduler Submission**: Passing unverified raw graphs directly to the single-chip serving scheduler.
- **Soft Validation**: Logging warnings for invalid plans but attempting to execute them anyway.

### Rationale
To guarantee system stability, prevent hardware hangs, and ensure accurate tracking of execution via `PhaseEvidenceReceipt`s, the scheduler must never handle raw artifacts. The lifecycle pipeline enforces validation of memory placements, residency, hardware affordances, and signature validity. If all checks pass, it yields an `AdmittedExecutionPlan`. If they fail, the artifact is quarantined and the scheduler rejects the request with structured `FailureEvidence`. This guarantees the scheduler operates only on proven, feasible plans, isolating the device bridge from untrusted data.

### Deferred Work
- Performance regression gating directly integrated into admission criteria.
- Pre-admission simulation of device execution times for improved scheduling heuristics.
