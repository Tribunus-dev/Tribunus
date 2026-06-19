# ADR 0030: Tenstorrent Full Stack Backend — Wormhole, Blackhole, Galaxy, and the Open RISC-V AI Ecosystem

## Status
Proposed — June 2026

## Context

Tenstorrent has shipped two generations of AI accelerator hardware with a third on the way, backed by a fully open-source software stack. Their architecture uses a spatial dataflow model where each Tensix core is an independent compute node with its own RISC-V CPUs, matrix FPU, vector SFPU, and 1.5 MB local SRAM, communicating through a Network-on-Chip. The product stack spans from a $999 Thunderbolt AI accelerator to a $110,000 rack-scale Galaxy server with 32 chips delivering 23 PFLOPS. As of June 2026, Qualcomm is in advanced negotiations to acquire Tenstorrent for $8-10 billion. The Tensix dataflow model maps naturally to Tribunus' operation graph and fusion planner — both represent computation as a DAG with explicit data movement between processing elements.

## Hardware Product Stack

### Wormhole n300 (2024, previous generation)

Dual ASICs, 128 Tensix cores (64 per ASIC) at 1 GHz, 192 MB SRAM, 24 GB GDDR6 (576 GB/s), 466 TOPS FP8, 300W, PCIe Gen4 x16, 2x QSFP-DD 400GbE. Available for immediate order. Powers the TT-QuietBox and TT-LoudBox developer workstations (4 cards, 8 ASICs). Also used in the Razer compact Thunderbolt 5 AI accelerator (CES 2026), which is daisy-chainable for multi-unit scaling.

### Blackhole p100 (April 2025)

Single ASIC, 120 Tensix cores, $999. No Ethernet. Active air cooling. Entry-level developer card.

### Blackhole p150 (April 2025)

Single ASIC, 120 Tensix cores, 664 TFLOPS BLOCK FP8, 180 MB SRAM, 32 GB GDDR6, 4x QSFP-DD 800GbE. Passive, active, and liquid-cooled variants at $1,399. Primary single-card development target.

### TT-QuietBox 2 (May 2026)

Liquid-cooled desktop with 4x Blackhole processors, 128 GB total memory. Quiet enough for home use. $11,999. Alternative: TT-LoudBox (air-cooled). The practical multi-card development target for testing 4-chip parallelism.

### Galaxy Blackhole Server (April 2026, GA)

6U air-cooled rack chassis, 32 Blackhole accelerators, AMD EPYC 9004 (Zen4 up to 32 cores). 23 PFLOPS BLOCK FP8. 1 TB GDDR6 (16 TB/s). 6.2 GB on-chip SRAM (2.9 PB/s). 56 x 800G Ethernet ports. $110,000 per server. Base supercluster (4 servers): $440,000. Galaxy Supercluster: up to 144 nodes, 4,608+ chips. Deployed at Equinix Distributed AI Hub.

## Decision

Implement a Tenstorrent backend covering the full product stack via TT-Metalium as the low-level SDK, with optional TT-Forge integration for higher-level graph compilation. The backend operates as a Tensix kernel compiler that lowers the Tribunus operation graph to Tensix reader/compute/writer kernels — fundamentally different from GPU-style dispatch.

### The Tensix Dataflow vs. GPU SIMT

On a GPU, compute is dispatched as precompiled shaders to a command queue. On Tensix, every operation requires a physical placement decision: which Tensix core runs which kernel, what data flows through which NoC route, and how SRAM circular buffers are sized. A single quantized matmul partitions weights across multiple cores, generates reader/compute/writer RISC-V kernels per core, sizes 1.5 MB SRAM buffers, and assigns NoC routes — then compiles all kernels and packages the program.

The Tribunus compiler already schedules operations and fuses kernels. The Tensix backend replaces the GPU-style executor with a Tensix kernel compiler that produces RISC-V binaries + NoC routing tables from the same IR. Compiled programs are cached and reused.

### Implementation Layers

**Layer 1: TT-Metalium FFI Bridge**

C FFI layer wrapping the TT-Metalium C++ API: device open/close (chip count, SRAM layout, NoC topology, Ethernet link map), kernel compilation (C++ to RISC-V binary), circular buffer allocation, program lifecycle, GDDR6 read/write via PCIe, Ethernet inter-chip transfer, NoC route query. Exposed as Rust async functions via tokio::task::spawn_blocking.

**Layer 2: Tensix Kernel Compiler**

Takes a fused operation DAG and produces Tensix kernels:
- Parse fused operation and tile across Tensix cores
- Generate reader/compute/writer kernel C++ per core
- Assign NoC routes balancing bandwidth
- Compile to RISC-V binary via TT-Metalium
- Package into cached program keyed on (operation_hash, tile_shape, num_cores, chip_count)

**Layer 3: Multi-Chip Topology**

TT-QuietBox (4 chips) and Galaxy (32 chips) present multi-chip topologies:
- Chips on same card (NoC): tensor parallelism with all-reduce per layer
- Chips across cards (QSFP-DD 800G): pipeline parallelism with layer segments per chip
- Chips across Galaxy servers (Ethernet): pipeline parallelism at server level
- Wormhole n300 dual-ASIC: Warp 100 Bridge at 200G with zero-overhead chip-to-chip communication

**Layer 4: TT-Forge Integration**

TT-Forge is Tenstorrent's MLIR-based compiler stack (public beta, 90% Hugging Face pass rate). Three integration options:
- Deep: lower Tribunus IR to TT-MLIR dialects (maximum optimization, API lock-in)
- Graph-level: export DAG to ONNX, import via TT-Forge-ONNX (reuses XDNA ONNX bridge)
- Skip: target TT-Metalium directly (recommended for v1, most stable)

**Layer 5: TensorBackend Adapter**

Thin adapter routing to Tensix compiler or CPU fallback. Compile-once, dispatch-many for all ops. Program cache keyed on operation hash and topology.

### Performance Projections

| System | Chips | 7B Q4 single | 7B Q4 batch 32 | 70B Q4 | Price |
|---|---|---|---|---|---|
| Blackhole p100 | 1x | 10-20 tok/s | 600-1000 tok/s | cannot load | $999 |
| Blackhole p150 | 1x | 10-20 tok/s | 600-1000 tok/s | cannot load | $1,399 |
| TT-QuietBox 2 | 4x | 40-80 tok/s | 2400-4000 tok/s | 5-10 tok/s | $11,999 |
| Galaxy Server | 32x | 320-640 tok/s | 19,000-32,000 tok/s | 60-150 tok/s | $110,000 |
| Galaxy Supercluster | 4,608x | N/A | 2.7M-4.6M tok/s | 8,640-21,600 tok/s | ~$15M |
| Razer TB5 (Wormhole) | 1x | 8-15 tok/s | 400-700 tok/s | cannot load | TBD |

### Software Stack

All components are 100% open source (AGPL):
- TT-Metalium: low-level C++ SDK for custom Tensix kernels
- TT-NN: PyTorch-style tensor operations
- TT-Forge: MLIR-based compiler (public beta, continuous development as of June 2026)
- TT-LLK: low-level kernel library
- TT-Lang: Python DSL for custom kernel authoring
- TT-Forge-Models: 800+ continuously tested model variants

### Risk and Mitigation

- **Qualcomm acquisition (June 2026):** Software direction may change. Mitigation: TT-Metalium is open source (AGPL), forkable. TT-Forge integration is optional.
- **RISC-V debugging:** Printf-based only via device logger. Mitigation: extensive CPU emulation before hardware tests.
- **TT-BUDA archived (Feb 2026):** No impact. TT-Forge replaces it. TT-Metalium remains stable.
- **BLOCK FP8 format requirement:** Extend quantization pipeline. No native FP32.
- **Wormhole vs Blackhole differences:** Same Tensix architecture, different core count and SRAM per core. Detect chip type at startup, adjust tiling.

### Non-Goals

- Not a GPU-style TensorBackend — it is a compiler to RISC-V binary
- Not for latency-critical single-batch inference
- Galaxy multi-node deferred until single-server verified
- Not for FP32 models without quantization

## Consequences

### Positive

- Scales from $999 Thunderbolt accelerator to $15M supercluster
- Dataflow DAG maps directly to Tribunus compiler
- Open source throughout — no NDAs, no binary blobs
- RISC-V independence via TT-Ascalon IP and Open Chiplet Atlas
- Galaxy server is GA with real deployments (Equinix Distributed AI Hub)
- 90% Hugging Face model pass rate via TT-Forge

### Negative

- Single-batch latency 2-3x worse than comparable GPU
- Full kernel compiler required — larger surface than GPU backends
- Printf-based RISC-V debugging only
- Qualcomm acquisition creates software direction uncertainty
- Requires BLOCK FP8 quantization pipeline
- Scale hardware is expensive ($11,999 QuietBox, $110,000 Galaxy)

### Estimated Effort

11-12 weeks (single developer):
- TT-Metalium FFI bridge: 1 week
- CPU fallback: 3 days
- Quantized matmul compiler: 2 weeks
- Full op compiler: 2 weeks
- Fused kernels: 1 week
- Multi-chip topology: 2 weeks
- TT-Forge integration: 1 week
- Conformance testing: 2 weeks

### Hardware Recommendation

Entry: Blackhole p100 ($999). Recommended: TT-QuietBox 2 with 4x Blackhole P150 ($11,999). For development before Blackhole delivery: Wormhole n300 cards work with the same TT-Metalium API.
