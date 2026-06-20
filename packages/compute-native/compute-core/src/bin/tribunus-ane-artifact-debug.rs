//! tribunus-ane-artifact-debug — Debug utility for ANE ComputeImage sealed artifacts.
//!
//! Loads a ComputeImage, finds a Core ML segment, runs the compiled model with
//! deterministic input, compares against a CPU reference (safetensors weights if
//! available, else identity), and emits an AneDispatchReceipt.
//!
//! Usage:
//!   cargo run --bin tribunus-ane-artifact-debug -- \
//!     --image-dir /path/to/image \
//!     --segment-id layer_00_mlp \
//!     --shape-key "1x1x128" \
//!     --input-seed 42 \
//!     [--tolerance 1e-2]
//!
//! Exit code:
//!   0 — numerical parity within tolerance
//!   1 — parity exceeded tolerance or an error occurred

use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use tribunus_compute_core::arena_info::ArenaInfo;
use tribunus_compute_core::compute_image::{Manifest, NumericValidationResult};
use tribunus_compute_core::coreml_bridge::{CoreMlComputeUnits, CoreMlModel};
use tribunus_compute_core::engine_receipts::AneDispatchReceipt;

// ── Configuration ─────────────────────────────────────────────────────────

struct Config {
    image_dir: PathBuf,
    segment_id: String,
    shape_key: String,
    input_seed: u64,
    tolerance: f64,
}

fn parse_args() -> Result<Config, String> {
    let args: Vec<String> = std::env::args().collect();
    let mut image_dir: Option<String> = None;
    let mut segment_id: Option<String> = None;
    let mut shape_key: Option<String> = None;
    let mut input_seed: Option<u64> = None;
    let mut tolerance: Option<f64> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--image-dir" => {
                i += 1;
                image_dir = Some(
                    args.get(i)
                        .ok_or_else(|| "--image-dir requires a value".to_string())?
                        .clone(),
                );
            }
            "--segment-id" => {
                i += 1;
                segment_id = Some(
                    args.get(i)
                        .ok_or_else(|| "--segment-id requires a value".to_string())?
                        .clone(),
                );
            }
            "--shape-key" => {
                i += 1;
                shape_key = Some(
                    args.get(i)
                        .ok_or_else(|| "--shape-key requires a value".to_string())?
                        .clone(),
                );
            }
            "--input-seed" => {
                i += 1;
                input_seed = Some(
                    args.get(i)
                        .ok_or_else(|| "--input-seed requires a value".to_string())?
                        .parse()
                        .map_err(|e| format!("invalid --input-seed: {}", e))?,
                );
            }
            "--tolerance" => {
                i += 1;
                tolerance = Some(
                    args.get(i)
                        .ok_or_else(|| "--tolerance requires a value".to_string())?
                        .parse()
                        .map_err(|e| format!("invalid --tolerance: {}", e))?,
                );
            }
            other => return Err(format!("unknown argument: {}", other)),
        }
        i += 1;
    }

    Ok(Config {
        image_dir: PathBuf::from(image_dir.ok_or_else(|| "--image-dir is required".to_string())?),
        segment_id: segment_id.ok_or_else(|| "--segment-id is required".to_string())?,
        shape_key: shape_key.unwrap_or_else(|| "1x1x128".to_string()),
        input_seed: input_seed.unwrap_or(42),
        tolerance: tolerance.unwrap_or(1e-2),
    })
}

// ── Deterministic input generation ──────────────────────────────────────

/// A simple LCG seeded RNG for deterministic float generation.
struct SeededRng {
    state: u64,
}

impl SeededRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_f32(&mut self) -> f32 {
        // Simple LCG: x_{n+1} = (a * x_n + c) mod 2^64
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        // Use top 24 bits for a float in [0, 1)
        let upper = (self.state >> 40) as u32;
        f32::from_bits((127 << 23) | (upper & 0x7FFFFF)) - 1.0
    }

    fn fill_f32(&mut self, buf: &mut [f32]) {
        for v in buf.iter_mut() {
            *v = self.next_f32();
        }
    }
}

// ── CPU reference computation ──────────────────────────────────────────

/// Simple CPU matmul: C = A @ B (row-major f32).
/// A: [M, K], B: [K, N], C: [M, N].
fn cpu_matmul(a: &[f32], b: &[f32], m: usize, k: usize, n: usize) -> Vec<f32> {
    let mut c = vec![0.0f32; m * n];
    for i in 0..m {
        for j in 0..n {
            let mut sum = 0.0f32;
            for t in 0..k {
                sum += a[i * k + t] * b[t * n + j];
            }
            c[i * n + j] = sum;
        }
    }
    c
}

/// Compute CPU reference output for a projection model: input @ weight.
/// If `weight_data` is None, returns a copy of input (identity check).
fn cpu_reference(
    input: &[f32],
    weight_data: Option<&[f32]>,
    m: usize,
    k: usize,
    n: usize,
) -> Vec<f32> {
    match weight_data {
        Some(w) => cpu_matmul(input, w, m, k, n),
        None => input.to_vec(),
    }
}

// ── Numerical comparison ────────────────────────────────────────────────

fn compute_numerical_validation(
    reference: &[f32],
    actual: &[f32],
    tolerance: f64,
) -> NumericValidationResult {
    assert_eq!(reference.len(), actual.len(), "output length mismatch");

    let n = reference.len();
    let mut max_abs_error = 0.0f64;
    let mut sum_sq_error = 0.0f64;
    let mut dot_product = 0.0f64;
    let mut ref_norm_sq = 0.0f64;
    let mut actual_norm_sq = 0.0f64;

    for i in 0..n {
        let r = reference[i] as f64;
        let a = actual[i] as f64;
        let diff = (r - a).abs();
        if diff > max_abs_error {
            max_abs_error = diff;
        }
        sum_sq_error += diff * diff;
        dot_product += r * a;
        ref_norm_sq += r * r;
        actual_norm_sq += a * a;
    }

    let rms_error = (sum_sq_error / n as f64).sqrt();
    let cosine_similarity = if ref_norm_sq > 0.0 && actual_norm_sq > 0.0 {
        dot_product / (ref_norm_sq.sqrt() * actual_norm_sq.sqrt())
    } else {
        1.0 // both zero → identical
    };

    NumericValidationResult {
        max_abs_error,
        rms_error,
        cosine_similarity,
        tolerance,
    }
}

// ── Safetensors weight loading ──────────────────────────────────────────

/// Try to load a weight as f32 from a safetensors file.
/// Returns the weight data, output dim N, and input dim K.
fn load_safetensors_weight(
    path: &Path,
    tensor_name: &str,
) -> Result<(Vec<f32>, usize, usize), String> {
    let data = fs::read(path).map_err(|e| format!("read safetensors: {}", e))?;
    let header_end = {
        let len_bytes: [u8; 8] = data[..8]
            .try_into()
            .map_err(|_| "invalid safetensors header length".to_string())?;
        u64::from_le_bytes(len_bytes) as usize
    };
    let header: serde_json::Value = serde_json::from_slice(&data[8..8 + header_end])
        .map_err(|e| format!("parse safetensors header: {}", e))?;

    let tensor_info = header
        .get(tensor_name)
        .ok_or_else(|| format!("tensor '{}' not found in safetensors", tensor_name))?;

    let dtype = tensor_info["dtype"]
        .as_str()
        .ok_or("missing dtype in safetensors")?;
    let shape: Vec<usize> = tensor_info["shape"]
        .as_array()
        .ok_or("missing shape in safetensors")?
        .iter()
        .map(|v| v.as_u64().unwrap_or(0) as usize)
        .collect();

    if shape.len() < 2 {
        return Err(format!("expected 2D weight shape, got {:?}", shape));
    }

    let data_offsets = tensor_info["data_offsets"]
        .as_array()
        .ok_or("missing data_offsets in safetensors")?;
    let offset: usize = data_offsets[0].as_u64().ok_or("invalid offset")? as usize + 8 + header_end;
    let length: usize =
        (data_offsets[1].as_u64().ok_or("invalid end")? as usize + 8 + header_end) - offset;

    let raw = &data[offset..offset + length];
    let values: Vec<f32> = match dtype {
        "F32" | "f32" => raw
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
            .collect(),
        "F16" | "f16" => raw
            .chunks_exact(2)
            .map(|c| {
                let bits = u16::from_le_bytes(c.try_into().unwrap());
                f32_from_f16(bits)
            })
            .collect(),
        other => return Err(format!("unsupported safetensors dtype: {}", other)),
    };

    let n = shape[0]; // output dim
    let k = shape[1]; // input dim
    Ok((values, n, k))
}

fn f32_from_f16(bits: u16) -> f32 {
    let sign = ((bits >> 15) & 1) as u32;
    let exp = ((bits >> 10) & 0x1F) as u32;
    let mant = (bits & 0x3FF) as u32;
    if exp == 0 {
        let value = (mant as f32) * 2.0f32.powi(-24);
        if sign != 0 {
            -value
        } else {
            value
        }
    } else if exp == 31 {
        f32::INFINITY
    } else {
        let normalized = 1.0f32 + (mant as f32) / 1024.0f32;
        let exponent = 2.0f32.powi((exp as i32) - 15);
        let value = normalized * exponent;
        if sign != 0 {
            -value
        } else {
            value
        }
    }
}

// ── Main ────────────────────────────────────────────────────────────────

fn main() {
    let result = run();
    match result {
        Ok(exit_code) => std::process::exit(exit_code),
        Err(e) => {
            eprintln!("error: {}", e);
            std::process::exit(1);
        }
    }
}

fn run() -> Result<i32, String> {
    let config = parse_args()?;

    eprintln!("=== ANE Artifact Debug ===");
    eprintln!("image-dir:   {:?}", config.image_dir);
    eprintln!("segment-id:  {}", config.segment_id);
    eprintln!("shape-key:   {}", config.shape_key);
    eprintln!("input-seed:  {}", config.input_seed);
    eprintln!("tolerance:   {}", config.tolerance);

    // ── 1. Load manifest ──────────────────────────────────────────────
    let manifest_path = config.image_dir.join("manifest.json");
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read manifest {}: {}", manifest_path.display(), e))?;
    let manifest: Manifest =
        serde_json::from_str(&manifest_content).map_err(|e| format!("parse manifest: {}", e))?;
    eprintln!("manifest.image_hash: {}", manifest.image_hash);

    // ── 2. Find CoreMlArtifactEntry ───────────────────────────────────
    let entry = manifest
        .coreml_artifacts
        .iter()
        .find(|e| e.segment_id == config.segment_id)
        .ok_or_else(|| {
            let available: Vec<&str> = manifest
                .coreml_artifacts
                .iter()
                .map(|e| e.segment_id.as_str())
                .collect();
            format!(
                "segment '{}' not found in manifest.coreml_artifacts (available: {:?})",
                config.segment_id, available
            )
        })?;

    eprintln!("  package_path:    {:?}", entry.package_path);
    eprintln!("  compiled_path:   {:?}", entry.compiled_path);
    eprintln!("  input_features:  {:?}", entry.input_feature_names);
    eprintln!("  output_features: {:?}", entry.output_feature_names);

    // Resolve compiled path (could be absolute or relative to image-dir)
    let compiled_path = if Path::new(&entry.compiled_path).is_absolute() {
        PathBuf::from(&entry.compiled_path)
    } else {
        config.image_dir.join(&entry.compiled_path)
    };

    if !compiled_path.exists() {
        return Err(format!(
            "compiled model path does not exist: {:?}",
            compiled_path
        ));
    }
    eprintln!("  resolved modelc: {:?}", compiled_path);

    let input_dtype = entry
        .input_dtypes
        .first()
        .cloned()
        .unwrap_or_else(|| "f32".to_string());
    let output_dtype = entry
        .output_dtypes
        .first()
        .cloned()
        .unwrap_or_else(|| "f32".to_string());
    let input_shape = entry.input_shapes.first().cloned().unwrap_or_default();
    let output_shape = entry.output_shapes.first().cloned().unwrap_or_default();

    // ── 3. Load Core ML model ─────────────────────────────────────────
    let model_path_str = compiled_path.to_string_lossy().to_string();
    eprint!("Loading Core ML model... ");
    let model = CoreMlModel::load_with_compute_units(
        &model_path_str,
        CoreMlComputeUnits::CpuAndNeuralEngine,
    )
    .map_err(|e| format!("CoreMlModel::load: {}", e))?;
    eprintln!("OK");

    // ── 4. Generate deterministic input ───────────────────────────────
    // Shape: typically [1, N] for the model. Use the input shape from the entry.
    let m = if input_shape.len() >= 2 {
        input_shape[0] as usize
    } else {
        1
    };
    let k = if input_shape.len() >= 2 {
        input_shape[1] as usize
    } else {
        input_shape.first().copied().unwrap_or(128) as usize
    };
    let n = if output_shape.len() >= 2 {
        output_shape[1] as usize
    } else {
        output_shape.first().copied().unwrap_or(128) as usize
    };

    let input_len = m * k;
    let output_len = m * n;

    let mut input_data = vec![0.0f32; input_len];
    let mut rng = SeededRng::new(config.input_seed);
    rng.fill_f32(&mut input_data);

    eprintln!(
        "Generated {} floats of input (shape [{}])",
        input_len,
        input_shape
            .iter()
            .map(|d| d.to_string())
            .collect::<Vec<_>>()
            .join("x")
    );

    // ── 5. CPU reference ──────────────────────────────────────────────
    eprint!("Computing CPU reference... ");
    let start_ref = Instant::now();

    // Try loading safetensors weights from the package weights directory
    let weight_data = if let Some(weight_ref) = entry.weight_references.first() {
        // Look for safetensors in the image directory
        let safetensors_candidates = vec![
            config
                .image_dir
                .join("weights")
                .join(format!("{}.safetensors", weight_ref.tensor_name)),
            config
                .image_dir
                .join(format!("{}.safetensors", weight_ref.tensor_name)),
        ];
        let mut found: Option<(Vec<f32>, usize, usize)> = None;
        for candidate in &safetensors_candidates {
            if candidate.exists() {
                match load_safetensors_weight(candidate, &weight_ref.tensor_name) {
                    Ok((w, dim_n, dim_k)) => {
                        eprintln!(
                            "loaded safetensors {} [{}x{}]",
                            candidate.display(),
                            dim_n,
                            dim_k
                        );
                        found = Some((w, dim_n, dim_k));
                        break;
                    }
                    Err(e) => {
                        eprintln!(
                            "  (safetensors load failed for {}: {})",
                            candidate.display(),
                            e
                        );
                    }
                }
            }
        }
        match found {
            Some((w, _, _)) => Some(w),
            None => {
                eprintln!("no safetensors found, using identity reference");
                None
            }
        }
    } else {
        eprintln!("no weight references, using identity reference");
        None
    };

    let cpu_output = cpu_reference(&input_data, weight_data.as_deref(), m, k, n);
    let ref_elapsed = start_ref.elapsed();
    eprintln!(
        "CPU reference: {} outputs in {:?}",
        cpu_output.len(),
        ref_elapsed
    );

    // ── 6. Core ML prediction ─────────────────────────────────────────
    eprint!("Running Core ML prediction... ");
    let start_pred = Instant::now();

    // Build FP32 input and output arenas (plain CPU memory, no IOSurface).
    let input_name = entry
        .input_feature_names
        .first()
        .cloned()
        .unwrap_or_else(|| "x".to_string());
    let output_name = entry
        .output_feature_names
        .first()
        .cloned()
        .unwrap_or_else(|| "output".to_string());

    // We must keep the backing Vecs alive until prediction completes.
    let mut input_raw = input_data.clone();
    let mut output_raw = vec![0.0f32; output_len];

    let input_arena = ArenaInfo {
        width: k as i32,
        height: m as i32,
        logical_dim0: m as i32,
        logical_dim1: k as i32,
        pixel_format: 0, // unused for CPU predict path
        byte_size: (input_len * 4) as i32,
        bytes_per_row: (k * 4) as i32,
        base_address: input_raw.as_mut_ptr() as *mut c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };

    let output_arena = ArenaInfo {
        width: n as i32,
        height: m as i32,
        logical_dim0: m as i32,
        logical_dim1: n as i32,
        pixel_format: 0,
        byte_size: (output_len * 4) as i32,
        bytes_per_row: (n * 4) as i32,
        base_address: output_raw.as_mut_ptr() as *mut c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };

    model
        .predict(&input_name, &input_arena, &output_name, &output_arena)
        .map_err(|e| format!("Core ML predict failed: {}", e))?;

    let pred_elapsed = start_pred.elapsed();
    let latency_us = pred_elapsed.as_micros() as u64;
    eprintln!("OK ({:?}, {} us)", pred_elapsed, latency_us);

    // ── 7. Compare outputs ────────────────────────────────────────────
    let validation = compute_numerical_validation(&cpu_output, &output_raw, config.tolerance);

    eprintln!();
    eprintln!("=== Numerical Validation ===");
    eprintln!("  max_abs_error:     {:.6e}", validation.max_abs_error);
    eprintln!("  rms_error:         {:.6e}", validation.rms_error);
    eprintln!("  cosine_similarity: {:.10}", validation.cosine_similarity);
    eprintln!("  tolerance:         {}", validation.tolerance);

    let parity_ok = validation.max_abs_error <= validation.tolerance
        && validation.rms_error <= validation.tolerance;

    // ── 8. Build and print AneDispatchReceipt ─────────────────────────
    let receipt = AneDispatchReceipt {
        image_hash: manifest.image_hash.clone(),
        segment_id: config.segment_id,
        artifact_hash: String::new(), // not computed yet
        model_path: model_path_str,
        compute_unit_policy: entry.compute_unit_policy.clone(),
        input_feature_names: entry.input_feature_names.clone(),
        output_feature_names: entry.output_feature_names.clone(),
        shape_key: config.shape_key,
        input_dtype,
        output_dtype,
        latency_us,
        numerical_validation: Some(validation.clone()),
        fallback_reason: None,
    };

    let receipt_json =
        serde_json::to_string_pretty(&receipt).map_err(|e| format!("serialize receipt: {}", e))?;
    println!("{}", receipt_json);

    // ── 9. Exit code ──────────────────────────────────────────────────
    if parity_ok {
        eprintln!("RESULT: PASS (numerical parity within tolerance)");
        Ok(0)
    } else {
        eprintln!(
            "RESULT: FAIL (max_abs_error {:.6e} > tolerance {})",
            validation.max_abs_error, validation.tolerance
        );
        Ok(1)
    }
}
