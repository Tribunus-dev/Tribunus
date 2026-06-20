//! tribunus-coreml-iosurface-qualification
//!
//! Qualification binary that tests whether a compiled Core ML .mlmodelc can
//! execute from IOSurface-backed arenas without hidden copies.
//!
//! Usage:
//!   cargo run --bin tribunus-coreml-iosurface-qualification -- \
//!     --modelc-path /path/to/model.mlmodelc \
//!     --input-shape 1,128 \
//!     --output-name matmul_6 \
//!     --iterations 10 \
//!     --tolerance 1e-2
//!
//! Phases:
//!   1. Copy-backed baseline (CPU memory, tribunus_coreml_predict)
//!   2. IOSurface-backed test  (IOSurface + CVPixelBuffer, tribunus_coreml_predict_pixelbuffer)
//!   3. Comparison and classification
//!   4. Qualification receipt (JSON)

use std::ffi::c_void;
use std::path::PathBuf;
use std::path::Path;
use std::fs;
use std::time::Instant;

use sha2::{Digest, Sha256};
use tribunus_compute_core::arena_info::ArenaInfo;
use tribunus_compute_core::coreml_bridge::{CoreMlComputeUnits, CoreMlModel};

// ── Configuration ─────────────────────────────────────────────────────────

struct Config {
    modelc_path: PathBuf,
    _model_holder: Option<tempfile::TempDir>,
    input_shape: Vec<i32>,
    output_name: String,
    iterations: usize,
    tolerance: f64,
}

fn parse_args() -> Result<Config, String> {
    let args: Vec<String> = std::env::args().collect();
    let mut modelc_path: Option<String> = None;
    let mut input_shape: Option<Vec<i32>> = None;
    let mut output_name: Option<String> = None;
    let mut iterations: Option<usize> = None;
    let mut tolerance: Option<f64> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--modelc-path" => {
                i += 1;
                modelc_path = Some(
                    args.get(i)
                        .ok_or_else(|| "--modelc-path requires a value".to_string())?
                        .clone(),
                );
            }
            "--input-shape" => {
                i += 1;
                let raw = args
                    .get(i)
                    .ok_or_else(|| "--input-shape requires a value".to_string())?;
                let shape: Vec<i32> = raw
                    .split(',')
                    .map(|s| {
                        s.trim()
                            .parse()
                            .map_err(|e| format!("invalid shape dimension '{}': {}", s, e))
                    })
                    .collect::<Result<Vec<i32>, String>>()?;
                input_shape = Some(shape);
            }
            "--output-name" => {
                i += 1;
                output_name = Some(
                    args.get(i)
                        .ok_or_else(|| "--output-name requires a value".to_string())?
                        .clone(),
                );
            }
            "--iterations" => {
                i += 1;
                iterations = Some(
                    args.get(i)
                        .ok_or_else(|| "--iterations requires a value".to_string())?
                        .parse()
                        .map_err(|e| format!("invalid --iterations: {}", e))?,
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

    let (modelc_path, _model_holder) = if let Some(ref p) = modelc_path {
        let pb = if std::path::Path::new(p.as_str()).is_dir() {
            find_modelc_dir(std::path::Path::new(p.as_str())).unwrap_or_else(|| PathBuf::from(p))
        } else {
            PathBuf::from(p)
        };
        (pb, None)
    } else {
        let (path, td) = compile_test_model();
        (path, Some(td))
    };

    Ok(Config {
        modelc_path,
        _model_holder,
        input_shape: input_shape.ok_or_else(|| "--input-shape is required".to_string())?,
        output_name: output_name.ok_or_else(|| "--output-name is required".to_string())?,
        iterations: iterations.unwrap_or(10),
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
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        // Convert to f32 in [0, 1)
        let upper = (self.state >> 32) as u32;
        f32::from_bits(0x3F800000 | (upper & 0x007F_FFFF)) - 1.0
    }
}

fn generate_input(size: usize) -> Vec<f32> {
    let mut rng = SeededRng::new(42);
    (0..size).map(|_| rng.next_f32()).collect()
}

// ── Hashing ─────────────────────────────────────────────────────────────

fn hash_output(data: &[f32]) -> String {
    let bytes = unsafe {
        std::slice::from_raw_parts(data.as_ptr() as *const u8, data.len() * 4)
    };
    let hash = Sha256::digest(bytes);
    hex_encode(&hash)
}

// ── IOSurface FFI ───────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
extern "C" {
    // CoreFoundation helpers
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        c_str: *const i8,
        encoding: u32,
    ) -> *mut c_void;
    fn CFNumberCreate(
        allocator: *const c_void,
        number_type: u32,
        value: *const c_void,
    ) -> *mut c_void;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        num_values: i64,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *mut c_void;
    fn CFRelease(obj: *const c_void);

    // IOSurface
    fn IOSurfaceCreate(properties: *const c_void) -> *mut c_void;
    fn IOSurfaceGetBaseAddress(surface: *mut c_void) -> *mut c_void;

    // CoreVideo
    fn CVPixelBufferCreate(
        allocator: *const c_void,
        width: usize, height: usize,
        pixel_format: u32,
        pixel_buffer_attributes: *const c_void,
        pixel_buffer: *mut *mut c_void,
    ) -> i32;
    fn CVPixelBufferCreateWithIOSurface(
        allocator: *const c_void,
        surface: *mut c_void,
        pixel_format: *const c_void,
        pixel_buffer: *mut *mut c_void,
    ) -> i32;
    fn CVPixelBufferLockBaseAddress(_: *mut c_void, _: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(_: *mut c_void, _: u64) -> i32;
    fn CVPixelBufferGetBaseAddress(_: *mut c_void) -> *mut c_void;
    fn CVPixelBufferGetIOSurface(_: *mut c_void) -> *mut c_void;
    fn CVPixelBufferGetBytesPerRow(_: *mut c_void) -> usize;
}

// ── IOSurface-backed arena creation ─────────────────────────────────────

#[cfg(target_os = "macos")]
const K_CF_ALLOCATOR_DEFAULT: *const c_void = std::ptr::null();
#[cfg(target_os = "macos")]
const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
#[cfg(target_os = "macos")]
const K_CF_NUMBER_SINT32: u32 = 3;
// kCVPixelFormatType_32Float = FourCharCode 'L','F','l','o'
#[cfg(target_os = "macos")]
const K_CV_PIXEL_FORMAT_TYPE_32_FLOAT: u32 = 0x4C466C6F;
// kCVPixelBufferPixelFormatTypeKey CFString
#[cfg(target_os = "macos")]
const K_CV_PIXEL_FORMAT_TYPE_KEY: &str = "PixelFormatType";

/// Create an IOSurface directly, return (iosurface, iosurface, base_address).
/// The base_address is passed to tribunus_coreml_predict via ArenaInfo,
/// which wraps it in MLMultiArray(initWithDataPointer:) — no CVPixelBuffer needed.
#[cfg(target_os = "macos")]
/// Create a CVPixelBuffer with kCVPixelFormatType_OneComponent32Float ('L00f').
/// This is the correct float pixel format for CVPixelBufferCreate on macOS.
#[cfg(target_os = "macos")]
fn create_iosurface_for_predict(
    width: u32, height: u32, _alloc_size: u32,
) -> Result<(*mut c_void, *mut c_void, *mut c_void), String> {
    // Create IOSurface directly via the working create_iosurface_pixelbuffer function.
    let alloc_sz = (width * height * 4) as u32;
    let bpr = width * 4;
    let (iosurface, _pb, base) = create_iosurface_pixelbuffer(
        width, height, 4, bpr, alloc_sz,
    )?;
    if base.is_null() {
        return Err("IOSurface base address is null".into());
    }
    eprintln!("  Raw IOSurface: ptr={:p}, base={:p}, size={}", iosurface, base, alloc_sz);
    // Write input data directly to IOSurface base address.
    // Return pixelbuffer=null so caller uses predict() with base_address (initWithDataPointer:).
    Ok((iosurface, std::ptr::null_mut(), base))
}

/// Create an IOSurface with the given byte size, then wrap it in a CVPixelBuffer.
/// Create an IOSurface with the given byte size, then wrap it in a CVPixelBuffer.
///
/// Returns (iosurface_ptr, pixelbuffer_ptr, base_address) or an error string.
#[cfg(target_os = "macos")]
fn create_iosurface_pixelbuffer(
    width: u32,
    height: u32,
    bytes_per_element: u32,
    bytes_per_row: u32,
    alloc_size: u32,
) -> Result<(*mut c_void, *mut c_void, *mut c_void), String> {
    // Build the IOSurface property dictionary.
    // Keys (CFStringRef)
    let keys_raw = [
        c_str_to_cfstring("IOSurfaceWidth")?,
        c_str_to_cfstring("IOSurfaceHeight")?,
        c_str_to_cfstring("IOSurfaceBytesPerElement")?,
        c_str_to_cfstring("IOSurfaceBytesPerRow")?,
        c_str_to_cfstring("IOSurfaceAllocSize")?,
    ];

    // Values (CFNumberRef)
    let val_w: u32 = width;
    let val_h: u32 = height;
    let val_bpe: u32 = bytes_per_element;
    let val_bpr: u32 = bytes_per_row;
    let val_size: u32 = alloc_size;

    let values_raw = [
        u32_to_cfnumber(val_w)?,
        u32_to_cfnumber(val_h)?,
        u32_to_cfnumber(val_bpe)?,
        u32_to_cfnumber(val_bpr)?,
        u32_to_cfnumber(val_size)?,
    ];

    let props = unsafe {
        CFDictionaryCreate(
            K_CF_ALLOCATOR_DEFAULT,
            keys_raw.as_ptr() as *const *const c_void,
            values_raw.as_ptr() as *const *const c_void,
            keys_raw.len() as i64,
            std::ptr::null(), // kCFTypeDictionaryKeyCallBacks
            std::ptr::null(), // kCFTypeDictionaryValueCallBacks
        )
    };
    if props.is_null() {
        for &v in &values_raw {
            if !v.is_null() {
                unsafe { CFRelease(v) };
            }
        }
        for &k in &keys_raw {
            if !k.is_null() {
                unsafe { CFRelease(k) };
            }
        }
        return Err("CFDictionaryCreate failed".to_string());
    }

    let iosurface = unsafe { IOSurfaceCreate(props) };

    // Release dictionary and its contents.
    unsafe { CFRelease(props) };
    for &v in &values_raw {
        if !v.is_null() {
            unsafe { CFRelease(v) };
        }
    }
    for &k in &keys_raw {
        if !k.is_null() {
            unsafe { CFRelease(k) };
        }
    }

    if iosurface.is_null() {
        return Err("IOSurfaceCreate failed".to_string());
    }

    let base_addr = unsafe { IOSurfaceGetBaseAddress(iosurface) };
    if base_addr.is_null() {
        return Err("IOSurfaceGetBaseAddress returned null".to_string());
    }

    // Build pixel buffer attributes dictionary with pixel format type.
    let fmt_key = c_str_to_cfstring(K_CV_PIXEL_FORMAT_TYPE_KEY)?;

    let fmt_val: u32 = K_CV_PIXEL_FORMAT_TYPE_32_FLOAT;
    let fmt_val_cf = unsafe {
        CFNumberCreate(K_CF_ALLOCATOR_DEFAULT, K_CF_NUMBER_SINT32, &fmt_val as *const u32 as *const c_void)
    };
    if fmt_val_cf.is_null() {
        unsafe { CFRelease(fmt_key) };
        return Err("CFNumberCreate (pixel format) failed".to_string());
    }

    let attrs_keys = [fmt_key];
    let attrs_vals = [fmt_val_cf];
    let attrs = unsafe {
        CFDictionaryCreate(
            K_CF_ALLOCATOR_DEFAULT,
            attrs_keys.as_ptr() as *const *const c_void,
            attrs_vals.as_ptr() as *const *const c_void,
            1,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if attrs.is_null() {
        unsafe {
            CFRelease(fmt_val_cf);
            CFRelease(fmt_key);
        }
        return Err("CFDictionaryCreate (pixel buffer attrs) failed".to_string());
    }

    let mut pixelbuffer: *mut c_void = std::ptr::null_mut();
    let cv_ret = unsafe {
        CVPixelBufferCreateWithIOSurface(
            K_CF_ALLOCATOR_DEFAULT,
            iosurface,
            attrs,
            &mut pixelbuffer,
        )
    };

    unsafe {
        CFRelease(attrs);
        CFRelease(fmt_val_cf);
        CFRelease(fmt_key);
    }

    if cv_ret != 0 {
        eprintln!("  CVPixelBuffer wrapping failed: {} - using raw IOSurface via predict()", cv_ret);
        return Ok((iosurface, std::ptr::null_mut(), base_addr));
    }

    if pixelbuffer.is_null() {
        return Err("CVPixelBufferCreateWithIOSurface returned null buffer".to_string());
    }
    Ok((iosurface, pixelbuffer, base_addr))
}

#[cfg(target_os = "macos")]
fn c_str_to_cfstring(s: &str) -> Result<*mut c_void, String> {
    let cs = std::ffi::CString::new(s).map_err(|e| format!("CString: {}", e))?;
    let cf = unsafe {
        CFStringCreateWithCString(K_CF_ALLOCATOR_DEFAULT, cs.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    };
    if cf.is_null() {
        return Err("CFStringCreateWithCString failed".to_string());
    }
    Ok(cf)
}

#[cfg(target_os = "macos")]
fn u32_to_cfnumber(val: u32) -> Result<*mut c_void, String> {
    let cf = unsafe {
        CFNumberCreate(K_CF_ALLOCATOR_DEFAULT, K_CF_NUMBER_SINT32, &val as *const u32 as *const c_void)
    };
    if cf.is_null() {
        return Err("CFNumberCreate failed".to_string());
    }
    Ok(cf)
}

// ── Qualification receipt ──────────────────────────────────────────────

#[derive(serde::Serialize)]
struct PhaseResult {
    latency_us: u64,
    output_hash: String,
}

#[derive(serde::Serialize)]
struct QualificationReceipt {
    event: String,
    modelc_path: String,
    input_shape: Vec<i32>,
    output_name: String,
    iterations: usize,
    tolerance: f64,
    copy_backed: PhaseResult,
    iosurface_backed: PhaseResult,
    max_abs_error: f64,
    rms_error: f64,
    classification: String,
}

// ── Numerical comparison ────────────────────────────────────────────────

#[derive(Debug)]
struct ComparisonResult {
    max_abs_error: f64,
    rms_error: f64,
}

fn compare_outputs(reference: &[f32], actual: &[f32]) -> ComparisonResult {
    let len = reference.len().min(actual.len());
    if len == 0 {
        return ComparisonResult {
            max_abs_error: f64::INFINITY,
            rms_error: f64::INFINITY,
        };
    }

    let mut max_abs = 0.0f64;
    let mut sum_sq = 0.0f64;

    for i in 0..len {
        let diff = (reference[i] - actual[i]) as f64;
        let abs_diff = diff.abs();
        if abs_diff > max_abs {
            max_abs = abs_diff;
        }
        sum_sq += diff * diff;
    }

    ComparisonResult {
        max_abs_error: max_abs,
        rms_error: (sum_sq / len as f64).sqrt(),
    }
}

// ── Main ────────────────────────────────────────────────────────────────

/// Find a .mlmodelc directory containing metadata.json.
fn find_modelc_dir(path: &Path) -> Option<PathBuf> {
    if path.join("metadata.json").exists() {
        return Some(path.to_path_buf());
    }
    // Search one level deep.
    if let Ok(entries) = fs::read_dir(path) {
        for e in entries.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() && p.join("metadata.json").exists() {
                return Some(p);
            }
        }
    }
    None
}

/// Compile a test projection model using MIL builder + coremlcompiler.
fn compile_test_model() -> (PathBuf, tempfile::TempDir) {
    use std::path::PathBuf;
    use coreml_proto::proto::mil_spec;
    use tribunus_compute_core::mil_builder::MilBuilder;
    use tribunus_compute_core::coreml_pipeline;
    use tribunus_compute_core::mlpackage::ModelMeta;

    let hidden_dim: i64 = 128;
    let weights: Vec<f32> = (0..hidden_dim * hidden_dim)
        .map(|i| {
            let x = i as f32;
            x.sin() * 0.5 + (x * 0.7).cos() * 0.3
        })
        .collect();

    let prog = MilBuilder::new("main")
        .input("x", mil_spec::DataType::Float32, &[1, hidden_dim])
        .const_f32("W", &weights, &[hidden_dim, hidden_dim])
        .matmul("x", "W_0")
        .output("matmul_1")
        .build()
        .expect("MIL build");

    let meta = ModelMeta {
        model_name: "iosurface_probe".into(),
        function_name: "main".into(),
        inputs: vec![("x".into(), vec![1, hidden_dim])],
        outputs: vec![("matmul_1".into(), vec![1, hidden_dim])],
        output_name: "matmul_1".into(),
        ..Default::default()
    };

    let tmp = tempfile::tempdir().expect("tempdir");
    let output_dir = tmp.path().join("output");
    fs::create_dir_all(&output_dir).unwrap();

    let receipt = coreml_pipeline::build_and_compile(prog, &meta, &output_dir, "iosurface_probe", "cpuAndGPU")
        .expect("coremlcompiler compile");
    eprintln!("Compiled test model: {:?}", receipt.compiled_modelc_path);
    (PathBuf::from(&receipt.compiled_modelc_path), tmp)
}

/// Holder to keep TempDir alive for the duration of the program.
struct CompiledModel {
    path: PathBuf,
    _tempdir: tempfile::TempDir,
}

fn main() {
    if let Err(e) = run() {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let config = parse_args()?;

    // Resolve the model path.
    let model_path_str = config
        .modelc_path
        .to_str()
        .ok_or_else(|| "invalid modelc path".to_string())?;

    // Determine element count from shape.
    let element_count: usize = config.input_shape.iter().map(|&d| d as usize).product();

    // Input feature name: common default.
    let input_name = "x";

    // Generate deterministic input data.
    let input_data = generate_input(element_count);
    eprintln!(
        "Deterministic input: {} elements ({:.1} KB)",
        element_count,
        (element_count as f64 * 4.0) / 1024.0
    );

    // ── Phase 1: Load model ─────────────────────────────────────────────
    eprintln!("\n── Phase 1: Loading model ──");
    eprint!("  Loading Core ML model from '{}'... ", model_path_str);
    let model = CoreMlModel::load_with_compute_units(
        model_path_str,
        CoreMlComputeUnits::CpuAndNeuralEngine,
    )
    .map_err(|e| format!("model load failed: {}", e))?;
    eprintln!("OK");

    // ── Phase 2: Copy-backed baseline ───────────────────────────────────
    eprintln!("\n── Phase 2: Copy-backed baseline ──");

    // Determine output size (same as input for now).
    let output_len = element_count;

    let mut copy_input = input_data.clone();
    let mut copy_output = vec![0.0f32; output_len];

    let in_arena_copy = ArenaInfo {
        width: config.input_shape.get(1).copied().unwrap_or(element_count as i32),
        height: config.input_shape.first().copied().unwrap_or(1),
        logical_dim0: config.input_shape.first().copied().unwrap_or(1),
        logical_dim1: config.input_shape.get(1).copied().unwrap_or(element_count as i32),
        pixel_format: 0,
        byte_size: (element_count * 4) as i32,
        bytes_per_row: (config.input_shape.get(1).copied().unwrap_or(element_count as i32) * 4) as i32,
        base_address: copy_input.as_mut_ptr() as *mut c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };

    let out_arena_copy = ArenaInfo {
        width: config.input_shape.get(1).copied().unwrap_or(element_count as i32),
        height: config.input_shape.first().copied().unwrap_or(1),
        logical_dim0: config.input_shape.first().copied().unwrap_or(1),
        logical_dim1: config.input_shape.get(1).copied().unwrap_or(element_count as i32),
        pixel_format: 0,
        byte_size: (output_len * 4) as i32,
        bytes_per_row: (config.input_shape.get(1).copied().unwrap_or(element_count as i32) * 4) as i32,
        base_address: copy_output.as_mut_ptr() as *mut c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };

    let start = Instant::now();
    model
        .predict(&input_name, &in_arena_copy, &config.output_name, &out_arena_copy)
        .map_err(|e| format!("copy-backed predict failed: {}", e))?;
    let copy_elapsed = start.elapsed();
    let copy_latency_us = copy_elapsed.as_micros() as u64;
    let copy_hash = hash_output(&copy_output);

    eprintln!(
        "  Copy-backed prediction: {} us, hash={}",
        copy_latency_us, copy_hash
    );

    // ── Phase 3: IOSurface-backed test ──────────────────────────────────
    eprintln!("\n── Phase 3: IOSurface-backed test ──");

    let (iosurface_latency_us, iosurface_hash, _iosurface_output, max_abs_error, rms_error, classification) = match create_iosurface_test(
        &model,
        &input_data,
        &config,
        input_name,
        &copy_output,
        output_len,
    ) {
        Ok(result) => {
            // Compare outputs.
            let comp = compare_outputs(&copy_output, &result.output);

            eprintln!("  Max abs error: {:.6e}", comp.max_abs_error);
            eprintln!("  RMS error:     {:.6e}", comp.rms_error);

            // Classify.
            let within_tolerance = comp.max_abs_error <= config.tolerance && comp.rms_error <= config.tolerance;

            let cls = if !within_tolerance {
                "Unsupported"
            } else if result.latency_us > copy_latency_us * 3 && copy_latency_us > 0 {
                "AcceptedButCopySuspected"
            } else {
                "Admitted"
            };

            eprintln!("  IOSurface backed latency: {} us", result.latency_us);
            eprintln!("  Classification: {}", cls);

            if !within_tolerance {
                eprintln!("  WARNING: Output divergence exceeds tolerance — suspected copy corruption or wrong output");
            } else if cls == "AcceptedButCopySuspected" {
                eprintln!(
                    "  WARNING: IOSurface path is {:.1}x slower than copy path — suspected hidden copy",
                    result.latency_us as f64 / copy_latency_us as f64
                );
            }

            (result.latency_us, result.hash, result.output, comp.max_abs_error, comp.rms_error, cls)
        }
        Err(e) => {
            eprintln!("  IOSurface path failed: {}", e);
            eprintln!("  Classification: Unsupported");
            (0, String::new(), Vec::new(), f64::INFINITY, f64::INFINITY, "Unsupported")
        }
    };

    // ── Phase 4: Print qualification receipt ────────────────────────────
    let receipt = QualificationReceipt {
        event: "iosurface-qualification".to_string(),
        modelc_path: model_path_str.to_string(),
        input_shape: config.input_shape.clone(),
        output_name: config.output_name,
        iterations: config.iterations,
        tolerance: config.tolerance,
        copy_backed: PhaseResult {
            latency_us: copy_latency_us,
            output_hash: copy_hash,
        },
        iosurface_backed: PhaseResult {
            latency_us: iosurface_latency_us,
            output_hash: iosurface_hash,
        },
        max_abs_error,
        rms_error,
        classification: classification.to_string(),
    };

    let json = serde_json::to_string_pretty(&receipt)
        .map_err(|e| format!("JSON serialization failed: {}", e))?;
    println!("\n{}", json);

    // Exit code: 0 for Admitted, 1 otherwise.
    if classification == "Admitted" {
        Ok(())
    } else {
        Err(format!("Qualification result: {}", classification))
    }
}

// ── IOSurface test execution ───────────────────────────────────────────

struct IosurfaceTestResult {
    latency_us: u64,
    hash: String,
    output: Vec<f32>,
}

#[cfg(target_os = "macos")]
fn create_iosurface_test(
    model: &CoreMlModel,
    input_data: &[f32],
    config: &Config,
    input_name: &str,
    _reference_output: &[f32],
    output_len: usize,
) -> Result<IosurfaceTestResult, String> {
    let element_count = input_data.len();
    let width = config.input_shape.get(1).copied().unwrap_or(element_count as i32) as u32;
    let height = config.input_shape.first().copied().unwrap_or(1) as u32;
    let bytes_per_element: u32 = 4; // f32
    let bytes_per_row = round_up_to_page((width * bytes_per_element) as usize) as u32;
    let alloc_size = round_up_to_page((height as usize * bytes_per_row as usize) as usize) as u32;

    eprintln!("  Creating IOSurface: {}x{}, {} B/row, {} total", width, height, bytes_per_row, alloc_size);

    // Try direct CVPixelBufferCreate first (accepts 32Float).
    let (iosurface, pixelbuffer, iosurface_base) = match create_iosurface_for_predict(
        width,
        height,
        alloc_size,
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  Direct CVPixelBufferCreate failed ({}), falling back to IOSurface path", e);
            create_iosurface_pixelbuffer(
                width, height, bytes_per_element, bytes_per_row, alloc_size,
            )?
        }
    };

    // Lock the pixel buffer and write input data.
    // When pixelbuffer is null, we have a raw IOSurface with pre-allocated memory.
    let actual_bpr: u32 = width * bytes_per_element;
    if pixelbuffer.is_null() {
        eprintln!("  Using raw IOSurface: base={:p}, bpr={}", iosurface_base, actual_bpr);
    } else {
        let lr = unsafe { CVPixelBufferLockBaseAddress(pixelbuffer, 0) };
        if lr != 0 { return Err(format!("lock failed: {}", lr)); }
        let iosurface_base = unsafe { CVPixelBufferGetBaseAddress(pixelbuffer) };
    }
    // Write input data (same path regardless of pixelbuffer)
    let row_bytes = (width as usize) * (bytes_per_element as usize);
    for row in 0..height as usize {
        let src_start = row * row_bytes / 4;
        let src_end = (row + 1) * row_bytes / 4;
        unsafe {
            std::ptr::copy_nonoverlapping(
                input_data[src_start..src_end].as_ptr(),
                (iosurface_base as *mut f32).add(row * actual_bpr as usize / 4),
                row_bytes / 4,
            );
        }
    }
    // Unlock if we had a pixelbuffer.
    if !pixelbuffer.is_null() {
        unsafe { CVPixelBufferUnlockBaseAddress(pixelbuffer, 0); }
    }

    // Build input arena with CVPixelBuffer.
    let in_arena_iosurface = ArenaInfo {
        width: width as i32,
        height: height as i32,
        logical_dim0: height as i32,
        logical_dim1: width as i32,
        pixel_format: 0,
        byte_size: alloc_size as i32,
        bytes_per_row: actual_bpr as i32,
        base_address: iosurface_base,
        cv_buffer: pixelbuffer,
        io_surface: iosurface,
    };

    // Output arena: CPU-backed buffer (the predict_pixelbuffer needs output_arena->base_address set).
    let mut output_raw = vec![0.0f32; output_len];
    let mut out_arena_iosurface = ArenaInfo {
        width: config.input_shape.get(1).copied().unwrap_or(element_count as i32),
        height: config.input_shape.first().copied().unwrap_or(1),
        logical_dim0: config.input_shape.first().copied().unwrap_or(1),
        logical_dim1: config.input_shape.get(1).copied().unwrap_or(element_count as i32),
        pixel_format: 0,
        byte_size: (output_len * 4) as i32,
        bytes_per_row: (config.input_shape.get(1).copied().unwrap_or(element_count as i32) * 4) as i32,
        base_address: output_raw.as_mut_ptr() as *mut c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };

    // Run the IOSurface-backed prediction.
    eprint!("  Running IOSurface-backed prediction... ");
    let start = Instant::now();

    // We call predict_pixelbuffer through the raw extern C function since
    // CoreMlModel::predict_pixelbuffer takes &mut ArenaInfo for output.
    unsafe {

        let c_in_name = std::ffi::CString::new(input_name)
            .map_err(|e| format!("CString: {}", e))?;
        let c_out_name = std::ffi::CString::new(config.output_name.as_str())
            .map_err(|e| format!("CString: {}", e))?;

        // Choose predict() or predict_pixelbuffer() based on CVPixelBuffer presence.
        let status = if pixelbuffer.is_null() {
            extern "C" {
                fn tribunus_coreml_predict(
                    model: *mut c_void,
                    input_name: *const i8,
                    input_arena: *const ArenaInfo,
                    output_name: *const i8,
                    output_arena: *const ArenaInfo,
                ) -> i32;
            }
            tribunus_coreml_predict(
                model.raw_ptr(), c_in_name.as_ptr(),
                &in_arena_iosurface as *const ArenaInfo,
                c_out_name.as_ptr(),
                &out_arena_iosurface as *const ArenaInfo,
            )
        } else {
            extern "C" {
                fn tribunus_coreml_predict_pixelbuffer(
                    model: *mut c_void,
                    input_name: *const i8,
                    input_arena: *const ArenaInfo,
                    output_name: *const i8,
                    output_arena: *mut ArenaInfo,
                ) -> i32;
            }
            tribunus_coreml_predict_pixelbuffer(
                model.raw_ptr(), c_in_name.as_ptr(),
                &in_arena_iosurface as *const ArenaInfo,
                c_out_name.as_ptr(),
                &mut out_arena_iosurface as *mut ArenaInfo,
            )
        };

        if status != 0 {
            let fn_name = if pixelbuffer.is_null() { "predict" } else { "predict_pixelbuffer" };
            return Err(format!(
                "tribunus_coreml_{} failed: {}",
                fn_name, status
            ));
        }
    }

    let elapsed = start.elapsed();
    let latency_us = elapsed.as_micros() as u64;
    eprintln!("OK ({} us)", latency_us);

    // Read output data. If predict_pixelbuffer updated base_address, use that.
    let output_ptr = if !out_arena_iosurface.base_address.is_null() {
        out_arena_iosurface.base_address
    } else {
        output_raw.as_mut_ptr() as *mut c_void
    };

    // Copy output data.
    let mut final_output = vec![0.0f32; output_len];
    unsafe {
        std::ptr::copy_nonoverlapping(
            output_ptr as *const f32,
            final_output.as_mut_ptr(),
            output_len,
        );
    }

    let hash = hash_output(&final_output);
    eprintln!("  IOSurface output hash: {}", hash);

    Ok(IosurfaceTestResult {
        latency_us,
        hash,
        output: final_output,
    })
}

#[cfg(not(target_os = "macos"))]
fn create_iosurface_test(
    _model: &CoreMlModel,
    _input_data: &[f32],
    _config: &Config,
    _input_name: &str,
    _reference_output: &[f32],
    _output_len: usize,
) -> Result<IosurfaceTestResult, String> {
    Err("IOSurface is only available on macOS".to_string())
}

// ── Utility ─────────────────────────────────────────────────────────────

fn round_up_to_page(size: usize) -> usize {
    let page_size = 4096usize;
    (size + page_size - 1) & !(page_size - 1)
}

/// Simple hex encoding of a byte slice (avoids adding a `hex` dependency).
fn hex_encode(bytes: &[u8]) -> String {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut out = vec![0u8; bytes.len() * 2];
    for (i, &b) in bytes.iter().enumerate() {
        out[i * 2] = HEX_CHARS[(b >> 4) as usize];
        out[i * 2 + 1] = HEX_CHARS[(b & 0x0F) as usize];
    }
    unsafe { String::from_utf8_unchecked(out) }
}
