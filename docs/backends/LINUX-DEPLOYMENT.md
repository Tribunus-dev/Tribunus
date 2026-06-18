# Linux Production Deployment Guide

This guide outlines the procedure for deploying Tribunus Compute in a production Linux environment.

## System Requirements

- **CPU**: Support for AMX or AVX2 instructions is required for efficient fallback compute.
- **RAM**: Minimum 16 GB (32 GB+ recommended for large models).
- **Disk**: 50 GB+ available space for caching model weights.
- **GPU (Optional)**: AMD RDNA3 (RX 7000/Ryzen 7040+) or Intel Arc/Core Ultra series for hardware acceleration.

## Installation Methods

You can install Tribunus Compute using one of the following methods:

1. **Debian Package (Recommended for Ubuntu/Debian)**
   ```bash
   sudo dpkg -i tribunus-compute_latest_amd64.deb
   sudo apt-get install -f # Install missing dependencies
   ```

2. **AppImage (Portable)**
   ```bash
   chmod +x Tribunus-Compute-x86_64.AppImage
   ./Tribunus-Compute-x86_64.AppImage
   ```

3. **Cargo Install (From Source)**
   ```bash
   cargo install --path packages/compute-native --features linux-vulkan,linux-intel
   ```

## Configuration

The compute node is configured via a TOML file. The system looks for it in the following locations:
1. `/etc/tribunus/config.toml` (System-wide)
2. `~/.config/tribunus/config.toml` (User-specific)

Example `config.toml`:
```toml
[compute]
backend_priority = ["vulkan", "level_zero", "cpu"]
vram_budget_mb = 8192

[network]
listen_addr = "0.0.0.0:8080"
```

## Valkey Setup

Tribunus Compute relies on Valkey Streams for transient coordination. You have two options:

1. **Bundled Valkey**: The system can spawn a bundled Valkey instance automatically. Ensure the binary path resolves correctly (default `/usr/bin/valkey-server` on Linux).
2. **System Valkey (Recommended for Production)**: Run an external Valkey instance and configure the compute node to connect to it via `config.toml`.

## systemd Service

For persistent background execution, set up a user-level `systemd` service:

1. Create `~/.config/systemd/user/tribunus-compute.service`:
   ```ini
   [Unit]
   Description=Tribunus Compute Node
   After=network.target

   [Service]
   ExecStart=/usr/local/bin/tribunus-compute
   Restart=always
   Environment="RUST_LOG=info"

   [Install]
   WantedBy=default.target
   ```
2. Enable and start the service:
   ```bash
   systemctl --user enable tribunus-compute.service
   systemctl --user start tribunus-compute.service
   ```

## Logging

To view the logs from the `systemd` service, use `journalctl`:

```bash
journalctl --user -u tribunus-compute -f
```

## Monitoring

- **HTTP Metrics**: A Prometheus-compatible metrics endpoint is exposed at `http://<listen_addr>/metrics`.
- **Receipt Logs**: Execution traces and timing information are output to the standard log streams. Monitor these to evaluate layer execution times across GPU/NPU/CPU.

## Troubleshooting

- **Common GPU Driver Issues**: Ensure your user is in the `video` and `render` groups. Run `vulkaninfo` or `sycl-ls` to verify device visibility.
- **VRAM Exhaustion**: If the node crashes with out-of-memory errors, reduce `vram_budget_mb` in `config.toml` or lower the model's batch size.
- **Kernel Panics**: Rare, but can occur with unstable beta drivers. Ensure you are running stable versions of Mesa or the Intel drivers.
