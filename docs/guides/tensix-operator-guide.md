# Tensix Operator Developer Guide

A living developer guide for adding new Tensix operator artifacts. Generated around actual extension points created by the other sessions.

Require every future operator session to update the guide and architecture index as part of its acceptance criteria.

## The Golden Path: Adding an Operator (e.g. RMSNorm)

If you are adding a new operator (e.g., `RMSNorm` as if it didn't exist yet), follow these steps to integrate it end-to-end:

### 1. Declare Artifact Manifest (S17)
Define the schema representing the sealed execution artifact.
- **Module Path:** `packages/compute-native/compute-core/src/compute_image_v0/tensix.rs`
- **Type Definition:** `TensixComputeArtifact` and `BackendCandidate`
- **Ownership:** Session 17
- **Action:** Add the new operator's manifest variant to the `TensixComputeArtifact` and `BackendCandidate` structures.

### 2. Define Capability & Compatibility Requirements
Ensure your operator can be safely compiled and executed.
- **Module Path:** `packages/compute-native/src/compiler/lowering/tensix/ir.rs`
- **Type Definition:** `TensixScheduleIR`
- **Action:** Define required chip capabilities (e.g., Wormhole vs. Blackhole) and ensure compatibility with the selected architecture.

### 3. Implement Reader/Compute/Writer Kernel Pattern
Write the data movement and compute kernels.
- **Module Path:** `packages/compute-native/src/primitives.rs` and related C++ kernel templates for TT-Metalium.
- **Type Definition:** `RmsNormOp` / `AttentionPrimitive` / etc.
- **Action:** Implement the RISC-V C++ kernel files defining how the Tensix core reads data from SRAM, computes the math, and writes back the result.

### 4. Register with Admission Gate (S25)
Ensure the executor refuses to run invalid or incompatible hardware artifacts.
- **Module Path:** `packages/compute-native/src/lifecycle/pipeline.rs`
- **Type Definition:** `TensixAdmissionState`
- **Ownership:** Session 25
- **Action:** Update the artifact lifecycle pipeline to parse and admit your new `TensixComputeArtifact` variant, verifying capacity, memory planner constraints, and topology.

### 5. Define Residency Contract (S23)
Define where tensors live on the device and their lifecycle.
- **Module Path:** `packages/compute-native/src/tensix/`
- **Type Definition:** `DeviceWeightResidency` / `ResidencyHandle`
- **Ownership:** Session 23
- **Action:** Define the exact `ResidencyHandle` mappings for your inputs and outputs, ensuring device memory layout requirements are met (e.g., padding, tile alignment).

### 6. Register Conformance Cases (S26)
Create automated tests that verify numerical correctness against a CPU baseline.
- **Test Suite:** `packages/compute-native/compute-core/tests/tensix_conformance.rs`
- **Ownership:** Session 26
- **Action:** Add a deterministic shape, invoke the operation, and assert that the TT-Metalium or mock executor output is within an acceptable numerical tolerance (e.g., `1e-2` BF16) of the CPU reference. Check explicitly for specific classes like `KernelCorrectness`.

### 7. Emit Evidence Schema (S20)
Provide auditable proof of execution and correctness.
- **Module Path:** `packages/compute-native/src/tensix/runtime.rs` and `tribunus_compute_core::inference_profile::evidence`
- **Type Definition:** `TensixDispatchReceipt` / `PhaseMetrics` / `PhaseEvidenceReceipt`
- **Ownership:** Session 20
- **Action:** Ensure your operator returns a structured `TensixDispatchReceipt` containing `PhaseMetrics` (latency, DRAM transfers, etc.) which is then stored in the `PhaseEvidenceReceipt`.

### 8. Compose into a Phase Plan
Integrate the operator into the larger execution plan.
- **Module Path:** `packages/compute-native/src/gemma.rs`
- **Action:** Bind the new operator to the inference graph compiler, mapping logical layers to your Tensix execution step.

### 9. Prove in Full-Stack Smoke Harness (S3)
Run end-to-end integration tests to verify the operator functions within a full model.
- **Test Suite:** `packages/compute-native/compute-core/tests/e2e_smoke.rs`
- **Ownership:** Session 3
- **Action:** Add the operator execution sequence to the full-stack static dispatch executor tests.

---

## Acceptance Criteria Checklist for New Operators

When implementing a new Tensix operator, verify the following:

- [ ] Artifact manifest declared in the appropriate schema (S17).
- [ ] Capability requirements explicitly defined.
- [ ] Reader/compute/writer kernels implemented.
- [ ] Registered and admitted successfully by the admission gate (S25).
- [ ] Device residency contracts and layout padding enforced (S23).
- [ ] Conformance tests added to `tensix_conformance.rs` passing within numerical limits (S26).
- [ ] Execution generates structured evidence/receipts (S20).
- [ ] Composed correctly into the parent model execution plan.
- [ ] End-to-end smoke tests pass (S3).
- [ ] The Developer Guide (this document) and Architecture Index are updated.
