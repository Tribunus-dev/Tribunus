# Tribunus Documentation

**Your coding agent. Its own inference engine. Open source, verifiable.**

Tribunus has two products:

**Tribunus Desktop** — The AI coding agent. A local-first control plane for your agents with capability boundaries, session state, approvals, and verifiable execution.

**Tribunus Compute** — A portable inference engine with compile-time architecture. Compiles model execution plans into verified compute images. Multi-backend by design: Metal, CUDA, Vulkan, ROCm, oneDNN, Level Zero, TT-NN (backend admission tracked publicly).

---

## Start Here

Choose your path:

- **Install Desktop** — macOS (arm64/x64), Linux (x64)
- **Understand Compute** — Architecture, ADRs, backends, compile pipeline
- **Contribute** — GitHub, issues, source code, ADRs

---

## Status

| Capability | Status |
|---|---|
| Desktop app (macOS, Linux) | [Implemented] |
| Plugin SDK | [Experimental] |
| Agent session management | [Implemented] |
| Compute Image pipeline | [In CI] |
| Apple Silicon backend (MLX) | [In progress] |
| NVIDIA backend (CUDA) | [In progress] |
| AMD / Intel / Tenstorrent | [Planned] |
| Agent marketplace | [Planned] |
| Federated inference (Dharma) | [Designed] |

---

## Architecture

Tribunus has three layers:

1. **Desktop** — Agent control plane. Sessions, approvals, receipts.
2. **Compute** — Inference engine. Compute images, backend admission, phase compilation.
3. **Evidence** — Receipts, seals, negative results, claim candidates.

(Federation will add a fourth layer: distributed inference with quorum verification.)

---

## What Is Real Today

- **Repo**: github.com/tribunus-dev (Tribunus-Compute, mlx-rs-fork, mlx-c-fork, mlx)
- **CI**: Green on macOS 26.5 (Apple Silicon M1/M2/M3/M4)
- **Model**: Qwen2.5 0.5B compiled as ComputeImage — 24 layers, 556 tensors, NF4 quantized
- **Backend**: MLX Metal GPU (primary), Accelerate CPU (fallback)
- **License**: AGPL v3
- **Attribution**: Built upon and inspired by the original OpenCode repository. Grateful to the original creators and contributors for their pioneering work on open-source coding agents.

---

> Compat: Tribunus preserves selected OpenCode config paths (opencode.json, OPENCODE_DB env vars, x-opencode-directory headers) during the transition to avoid breaking existing users. The CLI transition is tracked as a separate milestone.