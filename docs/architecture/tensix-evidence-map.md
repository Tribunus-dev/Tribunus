# TT-Metalium Architecture Evidence Map

This document outlines the architectural components of Tenstorrent's Tensix platform and mapping of the TT-Metalium programming model, highlighting stable interfaces and distinguishing features between architectures.

## Host Program Creation
The `tt_metal` host API provides abstractions for managing the host-to-device execution workflow. These APIs are primarily found in `tt_metal/api/tt-metalium/host_api.hpp` and `tt_metal/api/tt-metalium/tt_metal.hpp`.

Stable interfaces for program creation and kernel instantiation include:
*   **`CreateProgram()`**: Instantiates a `Program` object, the core container for a dispatchable workload. (Location: `tt_metal/api/tt-metalium/host_api.hpp`)
*   **`CreateKernel()`**: Associates a compiled kernel (from source) with a program, specific core ranges (`CoreRange`, `CoreRangeSet`), and a configuration (`DataMovementConfig`, `ComputeConfig`).
*   **`SetRuntimeArgs()`**: Used extensively to configure dynamic inputs (e.g., buffer addresses, limits) for kernels without requiring recompilation.

## Tensix Compute Kernels
Compute kernels interface with the mathematical units (FPU/SFPU). They are configured via `ComputeConfig` (`tt_metal/api/tt-metalium/kernel_types.hpp`), specifying properties such as:
*   `MathFidelity`
*   `fp32_dest_acc_en`
*   `bfloat8_pack_precise`

Compute kernels interface directly with circular buffer registers via hardware abstractions like `add_tiles_init` and `add_tiles` (found in `tt_metal/hw/inc/api/compute/eltwise_binary.h`).

## BRISC/NCRISC Data Movement
Data movement configurations dictate which processor (`DataMovementProcessor::RISCV_0`, `DataMovementProcessor::RISCV_1`) executes the code and which Network-on-Chip (NoC) to use.
*   The `DataMovementConfig` struct configures the data movement processor and NoC assignments. (Found in `tt_metal/api/tt-metalium/kernel_types.hpp`).
*   `ReaderDataMovementConfig` and `WriterDataMovementConfig` subclass this structure to provide defaults representing the standard paradigm of using RISCV_0/NoC_0 for reading and RISCV_1/NoC_1 for writing.

## Circular Buffers
Circular buffers are the intermediary storage enabling asynchronous execution across kernels. They act as producer/consumer queues in SRAM.
*   **`CreateCircularBuffer`**: Associates a `CircularBufferConfig` with a `Program` on specific core coordinates. (Found in `tt_metal/api/tt-metalium/host_api.hpp`).
*   Configuration dictates buffer index bindings (e.g., `tt::CBIndex::c_0`) to specific data layouts (`tt::DataFormat::Float16_b`), scaling up to defined capacities (bytes/pages).

## NoC Access
Network on Chip components are fundamental to the architecture, wrapping around the grid. NoC interactions are implicitly managed by the data movement configurations described above. They provide async transfers coordinated via endpoints. Data movement configuration also configures `NOC_MODE` (e.g., `DM_DEDICATED_NOC`). Hardware APIs for manipulating NoC are available in `tt_metal/hw/inc/api/dataflow/noc.h`.

## Tensor Memory Layouts
Data is primarily configured in memory using Tile formats natively supported by the Tensix units (32x32 tiles) or packed formats (e.g., bfloat16, float32, mxfp4). Headers defining the tensor/data formats include:
*   `tt_metal/api/tt-metalium/bfloat16.hpp`
*   `tt_metal/api/tt-metalium/bfloat8.hpp`
*   `tt_metal/api/tt-metalium/tile.hpp`

## Kernel Build Inputs
Kernels are JIT compiled or compiled offline. Configs (`DataMovementConfig`, `ComputeConfig`) expose options for:
*   **Compile Arguments**: (`std::vector<uint32_t> compile_args`)
*   **Defines**: (`std::map<std::string, std::string> defines`)
*   **Include Paths**: (`std::vector<std::filesystem::path> compiler_include_paths`)
*   **Optimization levels**: `opt_level` (e.g., `O2`, `O3`, `Os`)

## Queue Submission & Event Completion
The queue submission API operates around asynchronous command queues (fast dispatch). Key functionalities include enqueuing programs, reading/writing buffers, and handling synchronization events.
*   **`EnqueueWriteMeshBuffer` / `EnqueueReadMeshBuffer`**: Used to push and pull data from multi-device meshes (Found in `tt_metal/api/tt-metalium/distributed.hpp`).
*   **`MeshEvent` & Synchronization**: Events (`enqueue_record_event`, `enqueue_wait_for_event`) are used to coordinate between compute (Queue 0) and data-transfer (Queue 1) queues. (Found in `tt_metal/api/tt-metalium/mesh_event.hpp`).

## Device Capability Discovery
Device capabilities, such as mesh size, dispatch queues, and architecture types, can be queried through the device abstraction:
*   **`MeshDevice::create_unit_mesh()`**: Bootstraps the logical or physical device. Found in `tt_metal/api/tt-metalium/mesh_device.hpp`.
*   Architecture specifics and feature sets are often driven by `tt_metal::DispatchCoreConfig` and static constants.

## Multi-Device Mesh Programming
The Mesh abstraction provides a unified layer to interact with single or multiple connected devices.
*   **`MeshDevice`**: Instantiated via `MeshDevice::create_unit_mesh()` or connected across nodes. (`tt_metal/api/tt-metalium/mesh_device.hpp`).
*   **`MeshBuffer`**: Manages replicated or sharded storage across devices in the mesh. (`tt_metal/api/tt-metalium/mesh_buffer.hpp`).
*   **`MeshWorkload`**: Bundles and dispatches parallel workloads onto the mesh. (`tt_metal/api/tt-metalium/mesh_workload.hpp`).

## Blackhole vs. Wormhole Capability Differences
The hardware generations differ in vector width, precision, and available instructions:
*   **Wormhole/Blackhole**: Features 32-element vectors with 32-bit floating point precision (unlike Grayskull which has 64-element vectors and 19-bit precision).
*   Blackhole and Wormhole share similar SFPU math implementations (e.g., they both support `float_to_int16` enabling better trigonometric reduction to `[-pi, pi]`), but require double the number of iterations (8) compared to Grayskull (4) for approximations like MacLaurin series.
*   Blackhole represents the next generation after Wormhole in data center topologies, natively supporting mesh connections similar to Wormhole but scaling further.

## Smallest Viable Direct-Dispatch Route for Tribunus
To integrate Tribunus directly with the Tenstorrent hardware using the `tt_metal` host API, the smallest viable execution path bypasses higher-level graph abstractions like TTNN in favor of direct fast dispatch programming. The steps are:

1.  **Device Init**: Call `tt::tt_metal::MeshDevice::create_unit_mesh(0)` to obtain a device context, and fetch `MeshCommandQueue`.
2.  **Buffer Allocation**: Map Tribunal tensors onto the device via `tt::tt_metal::MeshBuffer::create()` specifying `dram_config` to store weights and transient state.
3.  **Program Creation**: Construct a `tt::tt_metal::Program`.
4.  **Circular Buffer Definition**: Use `tt::tt_metal::CreateCircularBuffer` to declare SRAM buffers for inputs/outputs mapped to tile formats.
5.  **Kernel Instantiation**:
    *   Create a Reader kernel (NCRISC/NoC_0) using `tt::tt_metal::CreateKernel` with `DataMovementConfig`.
    *   Create a Compute kernel using `tt::tt_metal::CreateKernel` with `ComputeConfig`.
    *   Create a Writer kernel (BRISC/NoC_1) using `tt::tt_metal::CreateKernel` with `DataMovementConfig`.
6.  **Argument Binding**: Use `tt::tt_metal::SetRuntimeArgs` to link host/DRAM buffers to the Data Movement kernels.
7.  **Dispatch**: Use `tt::tt_metal::EnqueueWriteMeshBuffer` to copy input data asynchronously. Submit the execution by calling `tt::tt_metal::EnqueueMeshWorkload` (or program enqueue APIs).
8.  **Completion & Extraction**: Synchronize completion via `EnqueueReadMeshBuffer` or `mesh_cq.enqueue_wait_for_event()` to retrieve compute results.

This process eliminates abstraction overhead and executes operations purely within the Tenstorrent data-movement pipeline semantics.
