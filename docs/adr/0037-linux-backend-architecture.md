# ADR 0037: Linux Backend Architecture

## Status
Proposed

## Context
The Linux ecosystem contains a wide variety of hardware architectures, particularly with the introduction of AI-specific accelerators (NPUs) and multiple discrete/integrated GPU vendors. To provide maximum compatibility and performance, Tribunus Compute needs a flexible and robust way to manage backends on Linux.

Previously, compute backends were either monolithic or tightly coupled to specific SDKs at compile time, leading to linker errors on unsupported hardware or forcing users into complex build configurations.

## Decision
We will implement a tiered backend selection architecture for Linux:

1. **Host-Side Compilation**: All compilation of compute kernels happens on the host, transforming high-level models into a vendor-neutral Intermediate Representation (IR), specifically SPIR-V or OpenVINO IR where applicable.
2. **Tiered Selection at Runtime**: At runtime, the compute node will probe available hardware and dynamically select the optimal backend based on a strict priority hierarchy:
   - **Tier 1 (Vulkan)**: Prioritized for AMD GPUs (RDNA architecture) and general cross-vendor GPU support.
   - **Tier 2 (Level Zero / OpenVINO)**: Specifically targeted when Intel hardware (Arc GPUs or Core Ultra NPUs) is detected to leverage XMX and specific Intel optimizations.
   - **Tier 3 (CPU Fallback)**: Always available, utilizing `libopenblas` and AMX/AVX2 instructions to guarantee execution if no accelerated hardware is found.
3. **Dynamic Loading**: We will use `dlopen` (via `libloading` or similar) and `/proc` filesystem checks to detect backends, strictly avoiding compile-time linker dependencies on proprietary SDKs.
4. **Opt-in Features**: Cargo features (`linux-vulkan`, `linux-intel`) will control the inclusion of backend-specific code, but the default `linux` feature will ensure the minimal CPU fallback compiles on any standard distribution.

## Consequences

### Positive
- **Guaranteed Execution**: Users will always be able to run models, falling back to the CPU if necessary.
- **Portability**: The default build works out-of-the-box on Debian, Ubuntu, Fedora, Arch, etc.
- **Maximized Performance**: Hardware owners (AMD/Intel) get near-native performance through specialized backends without compromising the experience for others.

### Negative
- **Complexity**: Managing dynamic loading and multiple execution paths increases the complexity of the runtime engine.
- **Testing Overhead**: CI must maintain multiple environments (Mesa, oneAPI) to verify all feature flags.
