//! ANE live runtime — owns loaded Core ML model handles for ANE segments.
//!
//! The runtime loads compiled `.mlmodelc` artifacts, runs warmup predictions
//! to verify model health, and dispatches live inference with IOSurface-backed
//! arena inputs. Each ANE segment gets its own `CoreMlModel` handle.

use std::collections::HashMap;
use std::time::Instant;

use crate::arena_info::ArenaInfo;
use crate::compute_image::CoreMlArtifactEntry;
use crate::coreml_bridge::{CoreMlComputeUnits, CoreMlModel};
use crate::engine_receipts::AneDispatchReceipt;
use mlx_rs::Array;

/// Owned Core ML model handles for ANE segments, keyed by segment ID.
pub struct AneLiveRuntime {
    /// Loaded Core ML models, keyed by segment ID.
    models: HashMap<String, CoreMlModel>,
    /// Artifact metadata for each loaded segment.
    artifacts: HashMap<String, CoreMlArtifactEntry>,
    /// Compute image hash (set during load).
    image_hash: String,
}

impl AneLiveRuntime {
    /// Create a new empty ANE live runtime.
    pub fn new() -> Self {
        Self {
            models: HashMap::new(),
            artifacts: HashMap::new(),
            image_hash: String::new(),
        }
    }

    /// Create a new runtime with a specific compute image hash.
    pub fn with_image_hash(image_hash: String) -> Self {
        Self {
            models: HashMap::new(),
            artifacts: HashMap::new(),
            image_hash,
        }
    }

    /// Set the compute image hash.
    pub fn set_image_hash(&mut self, image_hash: String) {
        self.image_hash = image_hash;
    }

    /// Get the compute image hash.
    pub fn image_hash(&self) -> &str {
        &self.image_hash
    }

    /// Return the number of loaded segments.
    pub fn loaded_segment_count(&self) -> usize {
        self.models.len()
    }

    /// Return the set of segment IDs that are currently loaded.
    pub fn loaded_segment_ids(&self) -> Vec<String> {
        self.models.keys().cloned().collect()
    }

    /// Load a Core ML model from the given artifact entry.
    ///
    /// The artifact's `compiled_path` points to the `.mlmodelc` directory
    /// produced by `coremlcompiler`. The compute-unit policy is taken from
    /// the artifact's `compute_unit_policy` field.
    ///
    /// Returns `Err` if loading fails (e.g. missing file, corrupt model).
    pub fn load_artifact(&mut self, artifact: &CoreMlArtifactEntry) -> Result<(), String> {
        let segment_id = &artifact.segment_id;

        if self.models.contains_key(segment_id) {
            return Err(format!(
                "segment '{}' is already loaded",
                segment_id
            ));
        }

        let compute_units = parse_compute_unit_policy(&artifact.compute_unit_policy)?;
        let model = CoreMlModel::load_with_compute_units(&artifact.compiled_path, compute_units)
            .map_err(|e| {
                format!(
                    "failed to load Core ML model for segment '{}' from '{}': {}",
                    segment_id, artifact.compiled_path, e
                )
            })?;

        self.models.insert(segment_id.clone(), model);
        self.artifacts.insert(segment_id.clone(), artifact.clone());
        Ok(())
    }

    /// Run a warmup prediction for the given artifact.
    ///
    /// Creates zero-filled dummy inputs matching the artifact's declared
    /// input shapes and dtypes, runs a prediction, and returns the wall-clock
    /// latency in microseconds.
    ///
    /// Returns `Err` if the model is not loaded or prediction fails.
    pub fn warmup(&self, artifact: &CoreMlArtifactEntry) -> Result<f64, String> {
        let segment_id = &artifact.segment_id;
        let model = self.models.get(segment_id).ok_or_else(|| {
            format!(
                "segment '{}' not loaded — call load_artifact first",
                segment_id
            )
        })?;

        let compute_units = parse_compute_unit_policy(&artifact.compute_unit_policy)?;
        let compute_units_label = match compute_units {
            CoreMlComputeUnits::CpuOnly => "cpu",
            CoreMlComputeUnits::CpuAndGpu => "cpu+gpu",
            CoreMlComputeUnits::CpuAndNeuralEngine => "cpu+ane",
            CoreMlComputeUnits::All => "all",
        };

        // Build dummy IOSurface-backed arenas for each input.
        let arena_info = match create_dummy_warmup_arena(artifact) {
            Ok(arena) => arena,
            Err(e) => {
                return Err(format!(
                    "failed to create warmup arena for segment '{}': {}",
                    segment_id, e
                ));
            }
        };

        let input_name = artifact
            .input_feature_names
            .first()
            .ok_or_else(|| format!("segment '{}' has no input features", segment_id))?;
        let output_name = artifact
            .output_feature_names
            .first()
            .ok_or_else(|| format!("segment '{}' has no output features", segment_id))?;

        let start = Instant::now();
        model
            .predict(input_name, &arena_info, output_name, &arena_info)
            .map_err(|e| {
                format!(
                    "warmup prediction failed for segment '{}' (compute_units={}): {}",
                    segment_id, compute_units_label, e
                )
            })?;
        let elapsed = start.elapsed();

        let latency_us = elapsed.as_secs_f64() * 1_000_000.0;
        Ok(latency_us)
    }

    /// Try to dispatch an MLP subgraph to the ANE, falling back gracefully.
    ///
    /// Reads an evaluated MLX `Array` as input, copies it to an arena,
    /// runs Core ML prediction, and returns the output as an MLX `Array`.
    /// Returns `Ok(None)` when `segment_id` is not loaded (caller should
    /// fall through to MLX).  Returns `Err` only on actual dispatch failure;
    /// the caller may still fall back to MLX on error.
    pub fn try_mlp_dispatch(
        &self,
        segment_id: &str,
        input: &Array,
        output_shape: &[i32],
    ) -> Result<Option<Array>, String> {
        // Not an ANE segment — caller falls through to MLX.
        if !self.models.contains_key(segment_id) {
            return Ok(None);
        }

        let artifact = self.artifacts.get(segment_id).ok_or_else(|| {
            format!("segment '{}' has no artifact metadata", segment_id)
        })?;

        let input_name = artifact.input_feature_names.first()
            .ok_or_else(|| format!("segment '{}' has no input features", segment_id))?;
        let output_name = artifact.output_feature_names.first()
            .ok_or_else(|| format!("segment '{}' has no output features", segment_id))?;

        // Read evaluated MLX array data as f32 slice. Panics if not evaluated.
        let input_slice = input.as_slice::<f32>();
        let input_bytes = input_slice.len() * 4;

        // Allocate pinned input buffer and copy MLX data.
        let input_size = input_bytes.max(1024) as u32;
        let inp_layout = std::alloc::Layout::from_size_align(input_size as usize, 64)
            .map_err(|e| format!("input layout: {}", e))?;
        let inp_base = unsafe { std::alloc::alloc_zeroed(inp_layout) };
        if inp_base.is_null() {
            return Err("ANE dispatch: failed to allocate input arena".to_string());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(
                input_slice.as_ptr() as *const u8,
                inp_base,
                input_bytes,
            );
        }

        let input_arena = ArenaInfo {
            width: output_shape.get(1).copied().unwrap_or(input_slice.len() as i32),
            height: output_shape.first().copied().unwrap_or(1),
            logical_dim0: output_shape.first().copied().unwrap_or(1),
            logical_dim1: output_shape.get(1).copied().unwrap_or(input_slice.len() as i32),
            pixel_format: 0,
            byte_size: input_size as i32,
            bytes_per_row: input_size as i32,
            base_address: inp_base as *mut std::ffi::c_void,
            cv_buffer: std::ptr::null_mut(),
            io_surface: std::ptr::null_mut(),
        };

        // Allocate output buffer and arena
        let output_elements: i32 = output_shape.iter().product();
        let output_bytes = (output_elements * 4) as u32;
        let out_layout = std::alloc::Layout::from_size_align(output_bytes as usize, 64)
            .map_err(|e| format!("output layout: {}", e))?;
        let out_base = unsafe { std::alloc::alloc_zeroed(out_layout) };
        if out_base.is_null() {
            unsafe { std::alloc::dealloc(inp_base, inp_layout); }
            return Err("ANE dispatch: failed to allocate output arena".to_string());
        }

        let output_arena = ArenaInfo {
            width: *output_shape.get(1).unwrap_or(&1),
            height: *output_shape.first().unwrap_or(&1),
            logical_dim0: *output_shape.first().unwrap_or(&1),
            logical_dim1: *output_shape.get(1).unwrap_or(&1),
            pixel_format: 0,
            byte_size: output_bytes as i32,
            bytes_per_row: output_bytes as i32,
            base_address: out_base as *mut std::ffi::c_void,
            cv_buffer: std::ptr::null_mut(),
            io_surface: std::ptr::null_mut(),
        };

        let result = self.models[segment_id].predict(
            &input_name,
            &input_arena,
            &output_name,
            &output_arena,
        );

        // Read output back regardless of result — need to clean up.
        let out_slice = if output_bytes > 0 {
            unsafe { std::slice::from_raw_parts(out_base as *const f32, output_elements as usize).to_vec() }
        } else {
            vec![]
        };

        unsafe { std::alloc::dealloc(inp_base, inp_layout); }
        unsafe { std::alloc::dealloc(out_base, out_layout); }

        result.map_err(|e| format!("ANE dispatch '{}': {}", segment_id, e))?;

        let out_arr = Array::from_slice(&out_slice, output_shape);
        Ok(Some(out_arr))
    }

    /// Dispatch live inference for a segment with arena-backed inputs.
    ///
    /// The `input_arena` provides IOSurface-backed pixel buffer data that
    /// the Core ML model processes directly (zero-copy). Returns the output
    /// bytes read back from the output arena.
    ///
    /// On failure returns `Err` — the caller handles fallback (e.g. CPU path).
    pub fn dispatch(
        &self,
        segment_id: &str,
        input_arena: &ArenaInfo,
    ) -> Result<Vec<u8>, String> {
        let model = self.models.get(segment_id).ok_or_else(|| {
            format!(
                "segment '{}' not loaded — call load_artifact first",
                segment_id
            )
        })?;

        let artifact = self.artifacts.get(segment_id).ok_or_else(|| {
            format!(
                "segment '{}' has no artifact metadata",
                segment_id
            )
        })?;

        let input_name = artifact
            .input_feature_names
            .first()
            .ok_or_else(|| format!("segment '{}' has no input features", segment_id))?;
        let output_name = artifact
            .output_feature_names
            .first()
            .ok_or_else(|| format!("segment '{}' has no output features", segment_id))?;

        // Allocate output buffer.
        let output_byte_size = input_arena.byte_size.max(1024);
        let output_layout = std::alloc::Layout::from_size_align(
            output_byte_size as usize,
            64,
        )
        .map_err(|e| format!("output layout error: {}", e))?;
        let output_base = unsafe { std::alloc::alloc_zeroed(output_layout) };
        if output_base.is_null() {
            return Err("failed to allocate output arena".to_string());
        }

        let output_arena = ArenaInfo {
            width: input_arena.width,
            height: input_arena.height,
            logical_dim0: input_arena.logical_dim0,
            logical_dim1: input_arena.logical_dim1,
            pixel_format: input_arena.pixel_format,
            byte_size: output_byte_size,
            bytes_per_row: input_arena.bytes_per_row,
            base_address: output_base as *mut std::ffi::c_void,
            cv_buffer: std::ptr::null_mut(),
            io_surface: std::ptr::null_mut(),
        };

        model
            .predict(input_name, input_arena, output_name, &output_arena)
            .map_err(|e| {
                // Free output buffer on failure.
                unsafe {
                    std::alloc::dealloc(output_base, output_layout);
                }
                format!(
                    "ANE dispatch failed for segment '{}': {}",
                    segment_id, e
                )
            })?;

        // Read back output bytes from the output arena.
        let output_bytes = if output_byte_size > 0 && !output_base.is_null()
        {
            unsafe {
                std::slice::from_raw_parts(
                    output_base as *const u8,
                    output_byte_size as usize,
                )
                .to_vec()
            }
        } else {
            Vec::new()
        };

        // Free the output buffer after reading.
        unsafe {
            std::alloc::dealloc(output_base, output_layout);
        }

        Ok(output_bytes)
    }

    /// Dispatch inference with full receipt tracking.
    ///
    /// Combines `dispatch` with receipt construction, capturing latency,
    /// feature names, shapes, and fallback information.
    pub fn dispatch_with_receipt(
        &self,
        segment_id: &str,
        input_arena: &ArenaInfo,
    ) -> Result<AneDispatchReceipt, String> {
        let artifact = self.artifacts.get(segment_id).ok_or_else(|| {
            format!(
                "segment '{}' has no artifact metadata",
                segment_id
            )
        })?;

        let start = Instant::now();
        let result = self.dispatch(segment_id, input_arena);
        let latency_us = start.elapsed().as_micros() as u64;

        let image_hash = if self.image_hash.is_empty() {
            artifact.segment_id.clone()
        } else {
            self.image_hash.clone()
        };

        let input_dtype = artifact
            .input_dtypes
            .first()
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());
        let output_dtype = artifact
            .output_dtypes
            .first()
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());
        let shape_key = artifact
            .input_shapes
            .first()
            .map(|s| {
                s.iter()
                    .map(|d| d.to_string())
                    .collect::<Vec<_>>()
                    .join("x")
            })
            .unwrap_or_default();

        match result {
            Ok(_output_bytes) => {
                Ok(AneDispatchReceipt {
                    image_hash,
                    segment_id: segment_id.to_string(),
                    artifact_hash: String::new(), // computed externally
                    model_path: artifact.compiled_path.clone(),
                    compute_unit_policy: artifact.compute_unit_policy.clone(),
                    input_feature_names: artifact.input_feature_names.clone(),
                    output_feature_names: artifact.output_feature_names.clone(),
                    shape_key,
                    input_dtype,
                    output_dtype,
                    latency_us,
                    numerical_validation: None,
                    fallback_reason: None,
                })
            }
            Err(e) => {
                Err(format!(
                    "ANE dispatch failed for segment '{}': {}",
                    segment_id, e
                ))
            }
        }
    }
}

impl Default for AneLiveRuntime {
    fn default() -> Self {
        Self::new()
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Map a compute-unit policy string to a `CoreMlComputeUnits` value.
fn parse_compute_unit_policy(policy: &str) -> Result<CoreMlComputeUnits, String> {
    match policy {
        "cpuOnly" | "cpu-only" | "cpu_only" => Ok(CoreMlComputeUnits::CpuOnly),
        "cpuAndGpu" | "cpu-and-gpu" | "cpu_and_gpu" => Ok(CoreMlComputeUnits::CpuAndGpu),
        "cpuAndNeuralEngine" | "cpu-and-neural-engine" | "cpu_and_neural_engine" => {
            Ok(CoreMlComputeUnits::CpuAndNeuralEngine)
        }
        "all" | "All" => Ok(CoreMlComputeUnits::All),
        _ => Err(format!(
            "unknown compute unit policy: '{}'; expected one of: \
             cpuOnly, cpuAndGpu, cpuAndNeuralEngine, all",
            policy
        )),
    }
}

/// Create a dummy warmup arena by allocating a zero-filled buffer.
///
/// The arena dimensions are derived from the artifact's input shapes; for
/// now we use a flat byte buffer that satisfies the byte_size of the first
/// input. In production this would use IOSurface-backed pixel buffers for
/// true zero-copy warmup.
fn create_dummy_warmup_arena(artifact: &CoreMlArtifactEntry) -> Result<ArenaInfo, String> {
    let input_shape = artifact
        .input_shapes
        .first()
        .ok_or_else(|| "no input shapes in artifact".to_string())?;

    // Calculate byte size from shape and dtype.
    let dtype = artifact
        .input_dtypes
        .first()
        .map(|s| s.as_str())
        .unwrap_or("f16");

    let element_bytes: i32 = match dtype {
        "f16" | "float16" => 2,
        "f32" | "float32" => 4,
        "f64" | "float64" => 8,
        "i8" | "int8" => 1,
        "i16" | "int16" => 2,
        "i32" | "int32" => 4,
        "u8" | "uint8" => 1,
        _ => {
            return Err(format!("unsupported dtype for warmup arena: {}", dtype));
        }
    };

    let element_count: i32 = input_shape.iter().map(|d| *d as i32).product();
    let byte_size = element_count * element_bytes;

    // Allocate zeroed memory for the warmup arena.
    let layout = std::alloc::Layout::from_size_align(
        byte_size as usize,
        64, // cache-line alignment
    )
    .map_err(|e| format!("layout error: {}", e))?;
    let base_address = unsafe { std::alloc::alloc_zeroed(layout) };
    if base_address.is_null() {
        return Err("failed to allocate warmup arena memory".to_string());
    }

    Ok(ArenaInfo {
        width: *input_shape.get(1).unwrap_or(&1) as i32,
        height: *input_shape.first().unwrap_or(&1) as i32,
        logical_dim0: *input_shape.first().unwrap_or(&1) as i32,
        logical_dim1: *input_shape.get(1).unwrap_or(&1) as i32,
        pixel_format: 0,
        byte_size,
        bytes_per_row: *input_shape.get(1).unwrap_or(&1) as i32 * element_bytes,
        base_address: base_address as *mut std::ffi::c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    })
}
