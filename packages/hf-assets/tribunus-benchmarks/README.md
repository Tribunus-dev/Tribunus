---
license: cc-by-4.0
task_categories:
  - text-generation
  - other
other:
  - systems-research
  - inference-benchmarking
tags:
  - tribunus
  - benchmarking
  - apple-silicon
  - mlx
  - coreml
  - inference
  - benchmark
  - leaderboard
---

# Dataset Card for Tribunus Benchmarks

This dataset is the curated, human-readable subset of the Tribunus Compute Evidence Corpus (`Tribunus-dev/compute-kernel-evidence`). It contains clean, aggregated benchmark results across MLX, Core ML, and Accelerate backends on Apple Silicon hardware, with standardized leaderboard figures ready for comparison and visualization.

While the full evidence corpus includes raw observations, experimental branches, and uncompiled diagnostics, this benchmark dataset is filtered, deduplicated, and normalized for direct consumption by dashboards, leaderboards, and publication tables.

## Data Structure

The dataset exposes a single `benchmarks` table with one row per (model, quantization, backend, hardware) combination at a specific test date:

| Column              | Type     | Description                                                  |
|---------------------|----------|--------------------------------------------------------------|
| `benchmark_id`      | UUID     | Stable identifier for this benchmark row                     |
| `run_id`            | UUID     | Foreign key into `compute-kernel-evidence.runs`              |
| `model_id`          | string   | Hugging Face model identifier (e.g., `mistralai/Mistral-7B-v0.1`) |
| `quantization`      | string   | Quantization scheme: `mlx-q4_0`, `mlx-q8_0`, `fp16`, `fp32` |
| `backend`           | string   | Inference backend: `mlx`, `coreml`, `accelerate`, `bnns`    |
| `tokens_per_second` | float    | Median generation throughput (tok/s)                         |
| `ttft_ms`           | float    | Median time-to-first-token (milliseconds)                    |
| `peak_memory_mb`    | float    | Peak memory usage during generation (MB)                     |
| `hardware_id`       | string   | Foreign key into `compute-kernel-evidence.hardware_profiles` |
| `test_date`         | datetime | ISO-8601 timestamp of benchmark execution                    |
| `compile_status`    | string   | Compilation outcome: `success`, `partial`, `failed`          |

## Methodology

The methodology follows the same measurement protocol as the full evidence corpus. See the [compute-kernel-evidence dataset card](https://huggingface.co/datasets/Tribunus-dev/compute-kernel-evidence) for detailed methodology, including:

- Warmup policy (3 tokens)
- Greedy decoding at temperature=0
- `mach_continuous_time` / `CLOCK_MONOTONIC` timing
- Minimum 3 repetitions per configuration
- Median aggregation with min/max bounds

The benchmark dataset applies the following additional curation steps:

- Rows where `repo_dirty = true` are excluded
- Rows with incomplete or failed compilation (`compile_status != 'success'`) are excluded
- Thermal outliers (thermal_mode != 'nominal') are excluded
- Multiple runs of the same configuration are aggregated by median
- Only the latest `dataset_release` is included

## Leaderboard Derivation

Every leaderboard figure published on the Tribunus project website is reproducible from the full evidence corpus. The benchmark dataset represents the canonical snapshot used for current leaderboard rankings.

To regenerate the leaderboard from the full evidence corpus:

```bash
python scripts/derive_leaderboard.py \
  --evidence-dir data/compute-kernel-evidence \
  --output-dir data/leaderboard \
  --release 2026-06
```

The derivation script performs the curation steps listed above and produces ranked tables per (backend, quantization, hardware) segment. The script source is available in the [Tribunus repository](https://github.com/Tribunus-dev/Tribunus).

## Citation

```bibtex
@misc{tribunus-benchmarks-2026,
  author = {Tribunus Compute Team},
  title = {Tribunus Benchmarks},
  year = {2026},
  publisher = {Hugging Face},
  journal = {Hugging Face Datasets},
  howpublished = {\url{https://huggingface.co/datasets/Tribunus-dev/tribunus-benchmarks}}
}
```

## License

The dataset is licensed under CC-BY-4.0. The generating code is MIT/AGPL-3.0.
