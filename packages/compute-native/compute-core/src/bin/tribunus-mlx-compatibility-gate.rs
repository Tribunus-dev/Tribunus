//! tribunus-mlx-compatibility-gate — Compatibility and short-sequence decode gate.
//! Performs smoke and authority-mode hardware benchmarking, environment telemetry,
//! and writes structured JSON evidence and decisions.

use serde::Serialize;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use mlx_rs::{Array, Device, Stream};
use tribunus_compute_core::mlx_api_compat::{CompatAttentionMask, MlxApiCompat};
use tribunus_compute_core::mlx_runtime_probe::MlxRuntimeProbeReport;

// ── Evidence structures ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct BenchStats {
    pub seq_len: u32,
    pub sample_count: usize,
    pub min_us: f64,
    pub max_us: f64,
    pub median_us: f64,
    pub p90_us: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FamilyResult {
    pub family_name: String,
    pub results: Vec<BenchStats>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompatibilityDecision {
    pub mlx_compatibility_decision: String,
    pub python_runtime_used: bool,
    pub short_decode_cliff_detected: bool,
    pub sdpa_mask_api: String,
    pub quant_optional_int_api: bool,
    pub metal_fallback_forced: bool,
    pub nax_checks_bypassed: bool,
    pub mlx_runtime_probe_written: bool,
    pub short_decode_bench_written: bool,
}

// ── Helpers for stats ─────────────────────────────────────────────────────

fn calculate_stats(seq_len: u32, mut samples: Vec<f64>) -> BenchStats {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let sample_count = samples.len();
    let min_us = samples[0];
    let max_us = samples[sample_count - 1];

    // Median
    let median_us = if sample_count % 2 == 0 {
        (samples[sample_count / 2 - 1] + samples[sample_count / 2]) / 2.0
    } else {
        samples[sample_count / 2]
    };

    // P90
    let p90_idx = (sample_count as f64 * 0.90).round() as usize;
    let p90_us = samples[p90_idx.min(sample_count - 1)];

    BenchStats {
        seq_len,
        sample_count,
        min_us,
        max_us,
        median_us,
        p90_us,
    }
}

// ── Main entry point ──────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = env::args().collect();
    let authority_mode = args.iter().any(|a| a == "--authority-mode" || a == "-a")
        || env::var("TRIBUNUS_MLX_SHORT_DECODE_AUTHORITY").is_ok();

    println!("============================================================");
    println!("TRIBUNUS MLX COMPATIBILITY & SHORT DECODE GATE-0001");
    println!(
        "Mode: {}",
        if authority_mode {
            "AUTHORITY (Full Sweep)"
        } else {
            "SMOKE (Fast Verification)"
        }
    );
    println!("============================================================");

    // 1. Compile-time check / API validation
    println!("[1/4] Verifying MLX FFI bindings signatures...");
    let _compat_mask = MlxApiCompat::get_sdpa_mask_params(&CompatAttentionMask::Causal);
    let _opt_int = MlxApiCompat::optional_int(256);
    let _opt_dtype = MlxApiCompat::optional_dtype_none();
    println!("      -> API Check: passed");

    // 2. Probe telemetry
    println!("[2/4] Gathering system and MLX runtime telemetry...");
    let report = MlxRuntimeProbeReport::probe();
    println!("      -> macOS: {}", report.os_version);
    println!(
        "      -> Metal forced fallback: {}",
        report.metal_fallback_forced
    );
    println!("      -> NAX checks bypassed: {}", report.nax_disabled);
    println!("      -> Python in path: {}", report.python_present);

    // 3. Benchmarking
    println!("[3/4] Running microbenchmarks...");
    let _device = Device::gpu();
    let stream = Stream::new();

    // Sequence lengths to benchmark
    let seq_lens = vec![1, 8, 16, 32, 64, 127, 128, 129, 256, 512];

    let warmup_count = if authority_mode { 10 } else { 2 };
    let sample_count = if authority_mode { 50 } else { 5 };

    // Family 1: sdpa_causal_mask_only
    let mut sdpa_results = Vec::new();
    let num_heads = 32;
    let head_dim = 128;
    let scale = 1.0f32 / (head_dim as f64).sqrt() as f32;

    for &len in &seq_lens {
        let q = Array::from_slice(
            &vec![0.1f32; (num_heads * len * head_dim) as usize],
            &[1, num_heads, len, head_dim],
        );
        let k = Array::from_slice(
            &vec![0.1f32; (num_heads * len * head_dim) as usize],
            &[1, num_heads, len, head_dim],
        );
        let v = Array::from_slice(
            &vec![0.1f32; (num_heads * len * head_dim) as usize],
            &[1, num_heads, len, head_dim],
        );
        let (mask_mode, mask_arr) =
            MlxApiCompat::get_sdpa_mask_params(&CompatAttentionMask::Causal);

        // Warmup
        for _ in 0..warmup_count {
            let mut res = unsafe { mlx_sys::mlx_array_new() };
            unsafe {
                mlx_sys::mlx_fast_scaled_dot_product_attention(
                    &mut res,
                    q.as_ptr(),
                    k.as_ptr(),
                    v.as_ptr(),
                    scale,
                    mask_mode.as_ptr(),
                    mask_arr,
                    mlx_sys::mlx_array_new(),
                    stream.as_ptr(),
                );
                let out = Array::from_ptr(res);
                let _ = out.eval();
            }
        }

        // Benchmark samples
        let mut samples = Vec::new();
        for _ in 0..sample_count {
            let start = Instant::now();
            let mut res = unsafe { mlx_sys::mlx_array_new() };
            unsafe {
                mlx_sys::mlx_fast_scaled_dot_product_attention(
                    &mut res,
                    q.as_ptr(),
                    k.as_ptr(),
                    v.as_ptr(),
                    scale,
                    mask_mode.as_ptr(),
                    mask_arr,
                    mlx_sys::mlx_array_new(),
                    stream.as_ptr(),
                );
                let out = Array::from_ptr(res);
                let _ = out.eval();
            }
            samples.push(start.elapsed().as_micros() as f64);
        }
        let stats = calculate_stats(len as u32, samples);
        sdpa_results.push(stats);
    }

    // Family 2: decode_microphase_like (Simulating query/key/value projections + attention)
    let mut decode_like_results = Vec::new();
    for &len in &seq_lens {
        let x = Array::from_slice(
            &vec![0.1f32; (len * head_dim) as usize],
            &[1, len, head_dim],
        );
        let w_q = Array::from_slice(
            &vec![0.2f32; (head_dim * head_dim) as usize],
            &[head_dim, head_dim],
        );
        let w_k = Array::from_slice(
            &vec![0.2f32; (head_dim * head_dim) as usize],
            &[head_dim, head_dim],
        );
        let w_v = Array::from_slice(
            &vec![0.2f32; (head_dim * head_dim) as usize],
            &[head_dim, head_dim],
        );

        // Warmup
        for _ in 0..warmup_count {
            let q_proj = x.matmul(&w_q).unwrap();
            let k_proj = x.matmul(&w_k).unwrap();
            let v_proj = x.matmul(&w_v).unwrap();

            // Reshape for attention
            let q_att = q_proj.reshape(&[1, 1, len, head_dim]).unwrap();
            let k_att = k_proj.reshape(&[1, 1, len, head_dim]).unwrap();
            let v_att = v_proj.reshape(&[1, 1, len, head_dim]).unwrap();

            let (mask_mode, mask_arr) =
                MlxApiCompat::get_sdpa_mask_params(&CompatAttentionMask::Causal);
            let mut res = unsafe { mlx_sys::mlx_array_new() };
            unsafe {
                mlx_sys::mlx_fast_scaled_dot_product_attention(
                    &mut res,
                    q_att.as_ptr(),
                    k_att.as_ptr(),
                    v_att.as_ptr(),
                    scale,
                    mask_mode.as_ptr(),
                    mask_arr,
                    mlx_sys::mlx_array_new(),
                    stream.as_ptr(),
                );
                let out = Array::from_ptr(res);
                let _ = out.eval();
            }
        }

        // Benchmark samples
        let mut samples = Vec::new();
        for _ in 0..sample_count {
            let start = Instant::now();
            let q_proj = x.matmul(&w_q).unwrap();
            let k_proj = x.matmul(&w_k).unwrap();
            let v_proj = x.matmul(&w_v).unwrap();

            let q_att = q_proj.reshape(&[1, 1, len, head_dim]).unwrap();
            let k_att = k_proj.reshape(&[1, 1, len, head_dim]).unwrap();
            let v_att = v_proj.reshape(&[1, 1, len, head_dim]).unwrap();

            let (mask_mode, mask_arr) =
                MlxApiCompat::get_sdpa_mask_params(&CompatAttentionMask::Causal);
            let mut res = unsafe { mlx_sys::mlx_array_new() };
            unsafe {
                mlx_sys::mlx_fast_scaled_dot_product_attention(
                    &mut res,
                    q_att.as_ptr(),
                    k_att.as_ptr(),
                    v_att.as_ptr(),
                    scale,
                    mask_mode.as_ptr(),
                    mask_arr,
                    mlx_sys::mlx_array_new(),
                    stream.as_ptr(),
                );
                let out = Array::from_ptr(res);
                let _ = out.eval();
            }
            samples.push(start.elapsed().as_micros() as f64);
        }
        let stats = calculate_stats(len as u32, samples);
        decode_like_results.push(stats);
    }

    // Print summary stats
    println!("\nBenchmark results (sdpa_causal_mask_only):");
    for s in &sdpa_results {
        println!(
            "  Sequence Length {}: median={:.2}us, p90={:.2}us",
            s.seq_len, s.median_us, s.p90_us
        );
    }

    // 4. Decision classification logic
    println!("\n[4/4] Generating compatibility decision...");

    // Check 127/128 ratio
    let median_127 = sdpa_results
        .iter()
        .find(|s| s.seq_len == 127)
        .map(|s| s.median_us)
        .unwrap_or(1.0);
    let median_128 = sdpa_results
        .iter()
        .find(|s| s.seq_len == 128)
        .map(|s| s.median_us)
        .unwrap_or(1.0);
    let ratio = median_127 / median_128;
    println!("      -> SDPA Latency Ratio (127 / 128): {:.4}", ratio);

    let mut cliff_detected = false;
    if ratio > 1.5 {
        println!("      [WARNING] Short-sequence decode performance cliff detected!");
        cliff_detected = true;
    }

    // Classify compatibility level
    let decision_str = if cliff_detected {
        "blocked".to_string()
    } else if report.metal_fallback_forced || report.nax_disabled {
        // Tahoe environment workarounds active -> research_only
        "research_only".to_string()
    } else {
        "authority_eligible".to_string()
    };

    println!("      -> Decision: {}", decision_str);

    let decision = CompatibilityDecision {
        mlx_compatibility_decision: decision_str,
        python_runtime_used: false, // We run purely natively in Rust
        short_decode_cliff_detected: cliff_detected,
        sdpa_mask_api: "current_single_array".to_string(),
        quant_optional_int_api: true,
        metal_fallback_forced: report.metal_fallback_forced,
        nax_checks_bypassed: report.nax_disabled,
        mlx_runtime_probe_written: true,
        short_decode_bench_written: true,
    };

    // Write all evidence files
    let compat_path = PathBuf::from("evidence/mlx/compatibility");
    fs::create_dir_all(&compat_path).unwrap();

    // 1. Write mlx_runtime_probe.json
    report.write_to_evidence(&compat_path).unwrap();

    // 2. Write short_decode_bench.json
    let bench_json = serde_json::json!({
        "sdpa_causal_mask_only": sdpa_results,
        "decode_microphase_like": decode_like_results,
    });
    fs::write(
        compat_path.join("short_decode_bench.json"),
        serde_json::to_string_pretty(&bench_json).unwrap(),
    )
    .unwrap();

    // 3. Write compatibility_decision.json
    fs::write(
        compat_path.join("compatibility_decision.json"),
        serde_json::to_string_pretty(&decision).unwrap(),
    )
    .unwrap();

    // 4. Write short_decode_gate.md summary report
    let md_summary = format!(
        "# Compatibility Gate Summary\n\n\
         * **Decision**: {}\n\
         * **Python runtime used**: false\n\
         * **Cliff detected**: {}\n\
         * **Ratio (127/128)**: {:.4}\n\
         * **Tahoe fallback active**: {}\n\
         * **NAX bypassed**: {}\n",
        decision.mlx_compatibility_decision,
        decision.short_decode_cliff_detected,
        ratio,
        decision.metal_fallback_forced,
        decision.nax_checks_bypassed
    );
    fs::write(compat_path.join("short_decode_gate.md"), md_summary).unwrap();

    println!("\nEvidence files written successfully to evidence/mlx/compatibility/");
    println!("Gate evaluation finished.");
}
