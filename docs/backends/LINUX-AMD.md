# AMD Linux Backend Architecture Guide

## Hardware Requirements

- **iGPU**: AMD Ryzen 7040/8040 Series (RDNA3)
- **dGPU**: AMD Radeon RX 6000/7000 Series
- **NPU**: XDNA NPU (Ryzen AI)

## Feature Flags

When building the backend on Linux, you can toggle specific backends with cargo features:

- `--features linux-vulkan`: Enables the Vulkan backend for AMD GPUs.
- `--features linux-cpu`: Explicitly enables the CPU-only fallback.

## Driver Installation

To run the compute backends effectively on AMD hardware, ensure the following are installed:

- **Mesa**: Version `24.1+` is required for optimal performance and compatibility.
- **Monitoring**: `rocm-smi-lib` for GPU monitoring and power management.
- **CPU Fallback**: `libopenblas` for efficient CPU matrix multiplication.

### Example (Ubuntu 24.04 / Debian)
```bash
sudo apt-get update
sudo apt-get install -y mesa-vulkan-drivers rocm-smi-lib libopenblas-dev
```

### Example (Fedora 40)
```bash
sudo dnf install mesa-vulkan-drivers rocm-smi-lib openblas-devel
```

## Known Limitations

- **Vulkan Subgroup Operations**: Advanced subgroup ops require Mesa `24.2+`.
- **Flash Attention**: Requires hardware support for `fp16` operations to be performant.

## Performance Tuning

For optimal performance on RDNA3 hardware:

- **Workgroup Sizes**: Tune workgroup sizes to match the RDNA3 architecture's Wave32 or Wave64 execution models.
- **Wavefront Occupancy**: Ensure high occupancy by managing shared memory and register pressure.
- **VRAM Budget**: Explicitly manage the VRAM budget to avoid out-of-memory errors during large model inference.

## Developer Setup

The recommended developer setup involves using an environment with the AMD ROCm kernel:

1. Use **Ubuntu 24.04** or **Fedora 40**.
2. Install the ROCm kernel module (`amdgpu-dkms`).
3. Ensure the user is in the `video` and `render` groups to access GPU devices.

```bash
sudo usermod -aG video,render $USER
```

## Troubleshooting

If you encounter issues, use the following tools to diagnose:

- `vkconfig validate`: Use the Vulkan validation layers to check for API errors.
- `vulkaninfo`: Verify that your GPU is detected and that required Vulkan extensions are present.
- **Missing Extensions**: If extensions are missing, check that you are running the latest version of Mesa and that the correct drivers are loaded.
