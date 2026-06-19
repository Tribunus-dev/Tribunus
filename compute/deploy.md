## macOS Deployment

On macOS, Tribunus Compute is embedded in the Tribunus desktop application. The compute kernel is compiled as a Rust native library (`tribunus-compute-native.darwin-arm64.node`) loaded by the Electron desktop shell.

### Launch

The desktop application starts a sidecar compute runtime during project activation. The bundled `tribunus-server.sh` script launches the inference server with automatic Valkey coordination and model loading.

### Model Placement

Models are managed through the Tribunus desktop UI or CLI. The ComputeImage compilation step runs automatically when a model is loaded, producing a machine-specific golden path before inference begins.

## Linux Deployment

### System Requirements

- **CPU:** AMX or AVX2 support for fallback compute
- **RAM:** Minimum 16 GB (32 GB+ recommended for large models)
- **Disk:** 50 GB+ for model weight caching
- **GPU (Optional):** AMD RDNA3 or Intel Arc/Core Ultra

### Installation Methods

1. **Debian Package (Ubuntu/Debian)**
   ```
   sudo dpkg -i tribunus-compute_latest_amd64.deb
   sudo apt-get install -f
   ```

2. **AppImage (Portable)**
   ```
   chmod +x Tribunus-Compute-x86_64.AppImage
   ./Tribunus-Compute-x86_64.AppImage
   ```

3. **Cargo Install (From Source)**
   ```
   cargo install --path packages/compute-native --features linux-vulkan,linux-intel
   ```

### Configuration

Compute node configuration via TOML:

```toml
[compute]
backend_priority = ["vulkan", "level_zero", "cpu"]
vram_budget_mb = 8192

[network]
listen_addr = "0.0.0.0:8080"
```

### Valkey Coordination

Tribunus Compute uses Valkey Streams for transient coordination between compute nodes. Valkey can be bundled (spawned automatically) or connected to an external instance.

### systemd Service

```ini
[Service]
ExecStart=/usr/local/bin/tribunus-compute
Restart=always
Environment="RUST_LOG=info"
```

### Monitoring

Prometheus-compatible metrics at `http://<listen_addr>/metrics`. Execution receipts (timing, backend selection, fallbacks) are logged to standard output streams.

## Docker Support

```bash
docker build -t tribunus-linux-dev -f scripts/docker-linux-dev.Dockerfile .
docker run -it --gpus all --device /dev/dri -v $(pwd):/workspace tribunus-linux-dev
```

The development container includes dependencies for both Intel and AMD GPU builds, providing a reproducible environment for compilation and testing.