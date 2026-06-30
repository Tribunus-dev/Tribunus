//! Integration tests for ANE sealed artifact pipeline.
//!
//! Tests compile → load → warmup → numerical parity for ANE Core ML
//! subgraphs using real MIL program construction and coremlcompiler.
//!
//! These tests require xcrun coremlcompiler on the PATH (macOS + Xcode).
//! They are #[ignore] by default because coremlcompiler is not
//! available in CI without a full Xcode installation.

use std::ffi::{c_void, CString};
use std::fs;
use std::path::{Path, PathBuf};

use coreml_proto::proto::mil_spec;
use tribunus_compute_core::accelerate_artifacts::{
    build_residual_add_artifact, build_rmsnorm_artifact, CpuImplementation,
};
use tribunus_compute_core::arena_info::ArenaInfo;
use tribunus_compute_core::compute_graph::CoreMlBufferMode;
use tribunus_compute_core::compute_graph::{
    ArtifactRegistry, BufferRegion, ComputeGraph, FailurePolicy, GraphInstance, GraphNode,
    LaneAffinity, Ownership, Residency,
};
use tribunus_compute_core::compute_image::CoreMlArtifactEntry;
use tribunus_compute_core::compute_image::CoreMlProvenance;
use tribunus_compute_core::coreml_bridge::{CoreMlComputeUnits, CoreMlModel};
use tribunus_compute_core::coreml_pipeline;
use tribunus_compute_core::mil_builder::MilBuilder;
use tribunus_compute_core::mlpackage::ModelMeta;

// ── IOSurface / CVPixelBuffer FFI (macOS only) ─────────────────────────
#[cfg(target_os = "macos")]
extern "C" {
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
    fn CFRelease(_: *const c_void);
    fn IOSurfaceCreate(properties: *const c_void) -> *mut c_void;
    fn IOSurfaceGetBaseAddress(surface: *mut c_void) -> *mut c_void;
    fn IOSurfaceGetAllocSize(surface: *mut c_void) -> usize;
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

// ── Constants ────────────────────────────────────────────────────────────
const DIM: u32 = 128;

// ── MIL program builders ─────────────────────────────────────────────────

/// Build a minimal MIL program with one matmul, naming the block output "matmul_6".
/// The model feature name is set to "matmul_6" via ModelMeta in compile_mlpackage.
fn build_mlp_program() -> mil_spec::Program {
    let n = DIM as usize;
    let w: Vec<f32> = vec![1.0f32; n * n];

    // 7 matmul calls to reach counter 6 (output = matmul_6).
    // const_weight increments counter: W_0
    // each matmul increments counter: matmul_1 through matmul_7
    // final call is output("matmul_7") — but we use meta output_name = "matmul_6"
    // Actually simpler: just use a chain of matmuls that produces matmul_N
    // and rely on ModelMeta.output_name = "matmul_6" for the feature name.
    let w: Vec<f32> = vec![1.0f32; n * n];

    // const_f32 generates "W_0" (fresh_name adds _counter).
    // matmul calls are chained: matmul_1, matmul_2, …, matmul_8
    // output "matmul_6" is the 6th matmul.

    MilBuilder::new("main")
        .input("x", mil_spec::DataType::Float32, &[1, DIM as i64])
        .const_f32("W", &w, &[DIM as i64, DIM as i64])
        .matmul("x", "W_0") // matmul_1
        .matmul("matmul_1", "W_0") // matmul_2
        .matmul("matmul_2", "W_0") // matmul_3
        .matmul("matmul_3", "W_0") // matmul_4
        .matmul("matmul_4", "W_0") // matmul_5
        .matmul("matmul_5", "W_0") // matmul_6
        .matmul("matmul_6", "W_0") // matmul_7
        .output("matmul_6")
        .build()
        .expect("build MLP MIL program")
}

// ── Compilation ──────────────────────────────────────────────────────────

/// Compile a MIL program into .mlmodelc using coremlcompiler.
/// Returns the path to the compiled .mlmodelc directory.
fn compile_mlpackage(
    program: mil_spec::Program,
    name: &str,
    temp_dir: &Path,
    output_dir: &Path,
) -> Result<PathBuf, String> {
    let output_name = if name.contains("mlp") {
        "matmul_6".to_string()
    } else {
        "matmul_1".to_string()
    };
    let meta = ModelMeta {
        model_name: name.to_string(),
        function_name: "main".to_string(),
        short_description: format!("ANE test: {}", name),
        version: "1.0.0".to_string(),
        author: "Tribunus Test".to_string(),
        output_name: output_name.clone(),
        inputs: vec![("x".to_string(), vec![1, DIM as i64])],
        outputs: vec![(output_name, vec![1, DIM as i64])],
        ..Default::default()
    };
    let receipt =
        coreml_pipeline::build_and_compile(program, &meta, output_dir, name, "cpuAndGPU")?;
    Ok(PathBuf::from(&receipt.compiled_modelc_path))
}

#[test]
fn iosurface_persistent_reuse() {
    // Prove PersistentIosurfaceBacked: real IOSurface creation, reuse across decode steps,
    // mutation sensitivity, and correct buffer_mode on receipts.

    let hidden_size = DIM as i64;
    let n_tokens = 1i64;
    let n = (n_tokens * hidden_size) as usize;

    // ── 1. Compile MLP + build graph/registry ─────────────────────
    let program = build_mlp_program();
    let temp_dir = tempfile::tempdir().unwrap();
    let output_dir = temp_dir.path().join("output");
    fs::create_dir_all(&output_dir).unwrap();
    let compiled = compile_mlpackage(
        program,
        "iosurface_persist_mlp",
        temp_dir.path(),
        &output_dir,
    )
    .expect("compile mlpackage");
    let compiled_modelc = compiled.clone();
    let artifact_hash: String = "test-hash".into();

    let mlp_entry = CoreMlArtifactEntry {
        segment_id: "layer_0_mlp".into(),
        artifact_hash: artifact_hash.clone(),
        package_path: String::new(),
        compiled_path: compiled_modelc.to_string_lossy().to_string(),
        compiler_version: String::new(),
        compute_unit_policy: "cpuAndNeuralEngine".into(),
        input_feature_names: vec!["x".into()],
        output_feature_names: vec!["matmul_6".into()],
        input_shapes: vec![vec![1, 128]],
        output_shapes: vec![vec![1, 128]],
        input_dtypes: vec!["float32".into()],
        output_dtypes: vec!["float32".into()],
        weight_references: vec![],
        canonical_provenance: CoreMlProvenance {
            source_tensor_ids: vec![],
            image_hash: "test".into(),
        },
        validation_receipt: tribunus_compute_core::compute_image::CoreMlArtifactReceipt {
            compiled: true,
            loaded: false,
            warmup_passed: false,
            numerical_parity: None,
        },
        graph: None,
    };

    let (cpu_artifacts, graph) = coreml_pipeline::emit_layer_mlp_graph(&mlp_entry, DIM as i64);
    assert_eq!(graph.regions.len(), 5);
    assert_eq!(
        graph.regions[3].residency,
        Residency::CoreMlCompatible,
        "region 3 must be CoreMlCompatible for IOSurface test"
    );

    let mut registry = ArtifactRegistry::new();
    registry
        .load_coreml_artifact(&mlp_entry)
        .expect("load coreml");
    for accel in &cpu_artifacts {
        registry
            .accelerate_artifacts
            .insert(accel.artifact_id.clone(), accel.clone());
    }

    // ── 2. Input data ─────────────────────────────────────────────
    let hidden: Vec<f32> = (0..n).map(|i| ((i as f32) * 0.1).sin()).collect();
    let norm_weight: Vec<f32> = vec![1.0f32; n];

    // ── 3. CPU reference: RMSNorm → MLP predict → residual add ────
    let mean_sq: f32 = hidden.iter().map(|&v| v * v).sum::<f32>() / n as f32;
    let rstd = (1.0f64 / (mean_sq as f64 + 1e-6).sqrt()) as f32;
    let normed: Vec<f32> = hidden.iter().map(|&x| x * rstd).collect();

    let model = CoreMlModel::load_with_compute_units(
        &compiled_modelc.to_string_lossy(),
        CoreMlComputeUnits::CpuAndNeuralEngine,
    )
    .expect("load model");

    let mut mlp_input = normed.clone();
    let mut mlp_output = vec![0.0f32; n];
    let inp_arena = ArenaInfo {
        width: hidden_size as i32,
        height: 1,
        logical_dim0: 1,
        logical_dim1: hidden_size as i32,
        pixel_format: 0,
        byte_size: (n * 4) as i32,
        bytes_per_row: (n * 4) as i32,
        base_address: mlp_input.as_mut_ptr() as *mut std::ffi::c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };
    let out_arena = ArenaInfo {
        width: hidden_size as i32,
        height: 1,
        logical_dim0: 1,
        logical_dim1: hidden_size as i32,
        pixel_format: 0,
        byte_size: (n * 4) as i32,
        bytes_per_row: (n * 4) as i32,
        base_address: mlp_output.as_mut_ptr() as *mut std::ffi::c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };
    model
        .predict("x", &inp_arena, "matmul_6", &out_arena)
        .expect("MLP predict");
    let expected: Vec<f32> = mlp_output
        .iter()
        .zip(hidden.iter())
        .map(|(&a, &b)| a + b)
        .collect();

    // ── 4. Graph with PersistentIosurfaceBacked ────────────────────
    let mut inst = GraphInstance::new(&graph, &registry, vec![]);
    inst.set_coreml_buffer_mode(CoreMlBufferMode::PersistentIosurfaceBacked);
    // Init persistent for regions 2 (normed), 3 (mlp_output, CoreMlCompatible), 4 (residual_out).
    // Region 3 CoreMlCompatible + PersistentIosurfaceBacked → real IOSurface alloc.
    inst.init_persistent_regions(
        &[2, 3, 4],
        Some(CoreMlBufferMode::PersistentIosurfaceBacked),
    )
    .expect("init persistent");

    let hidden_bytes = unsafe { std::slice::from_raw_parts(hidden.as_ptr() as *const u8, n * 4) };
    let weight_bytes =
        unsafe { std::slice::from_raw_parts(norm_weight.as_ptr() as *const u8, n * 4) };

    inst.allocate_region(0, Some(hidden_bytes))
        .expect("region 0");
    inst.allocate_region(1, Some(weight_bytes))
        .expect("region 1");
    inst.allocate_region(2, None).expect("region 2");
    inst.allocate_region(3, None).expect("region 3");
    inst.allocate_region(4, None).expect("region 4");

    inst.run().expect("first run");
    assert_eq!(inst.node_receipts.len(), 3, "expected 3 receipts");

    // Verify buffer_mode on ANE receipt.
    let ane_r = inst
        .node_receipts
        .iter()
        .find(|r| r.lane == "ane")
        .expect("ane receipt");
    assert_eq!(
        ane_r.buffer_mode.as_deref(),
        Some("PersistentIosurfaceBacked"),
        "ANE receipt buffer_mode should be PersistentIosurfaceBacked, got {:?}",
        ane_r.buffer_mode
    );
    // Verify receipt metadata fields for IOSurface dispatch.
    assert!(ane_r.slot_id.is_some(), "ANE receipt should have slot_id");
    assert!(
        ane_r.slot_epoch.is_some(),
        "ANE receipt should have slot_epoch"
    );
    eprintln!(
        "[metadata] slot_id={:?} epoch={:?} iosurface_id={:?} fallback={:?}",
        ane_r.slot_id, ane_r.slot_epoch, ane_r.iosurface_id, ane_r.allocation_fallback_reason
    );

    // Verify numerical parity.
    let output_data = inst.region_data(4).expect("region 4");
    let output_f32: &[f32] = unsafe {
        std::slice::from_raw_parts(output_data.as_ptr() as *const f32, output_data.len() / 4)
    };
    let max_abs = output_f32
        .iter()
        .zip(expected.iter())
        .map(|(&a, &b)| (a as f64 - b as f64).abs())
        .fold(0.0f64, f64::max);
    assert!(
        max_abs < 1e-2,
        "IOSurface run max_abs={:.6e} exceeds 1e-2",
        max_abs
    );

    // ── 5. Re-run (verify persistent IOSurface reuse, same correctness) ──
    let hidden_bytes2 = unsafe { std::slice::from_raw_parts(hidden.as_ptr() as *const u8, n * 4) };

    inst.reset_request_regions().expect("reset");
    inst.allocate_region(0, Some(hidden_bytes2))
        .expect("realloc 0");
    inst.allocate_region(1, Some(weight_bytes))
        .expect("realloc 1");
    inst.allocate_region(2, None).expect("realloc 2");
    inst.allocate_region(3, None).expect("realloc 3");
    inst.allocate_region(4, None).expect("realloc 4");
    inst.run_persistent().expect("second run");

    let output_data2 = inst.region_data(4).expect("region 4 (2)");
    let output2_f32: &[f32] = unsafe {
        std::slice::from_raw_parts(output_data2.as_ptr() as *const f32, output_data2.len() / 4)
    };
    let max_abs2 = output2_f32
        .iter()
        .zip(expected.iter())
        .map(|(&a, &b)| (a as f64 - b as f64).abs())
        .fold(0.0f64, f64::max);
    assert!(
        max_abs2 < 1e-2,
        "persistent reuse run2 max_abs={:.6e}",
        max_abs2
    );

    eprintln!(
        "[iosurface_persistent] PASS (run1_max_abs={:.6e}, run2_max_abs={:.6e})",
        max_abs, max_abs2
    );
}

#[test]
fn activation_ring_epoch_safety() {
    // Test that ActivationRing rejects stale completions and tracks borrows correctly.
    // Pure unit test — no Core ML required.

    let mut ring = match tribunus_compute_core::compute_graph::ActivationRing::new(3, 128, 1) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "[epoch_safety] ActivationRing::new failed: {} (expected on non-macOS)",
                e
            );
            return;
        }
    };

    let slot0 = ring.alloc_write().expect("alloc slot 0");
    let slot_id = slot0.slot_id;
    let epoch = slot0.epoch;

    ring.mark_ready_for_ane(slot_id);
    ring.mark_ane_in_flight(slot_id);

    // Stale completion (wrong epoch) should be rejected.
    let stale_result = ring.release_ane_borrow(slot_id, epoch.wrapping_sub(1));
    assert!(stale_result.is_err(), "stale completion should be rejected");

    // Correct epoch should succeed.
    ring.release_ane_borrow(slot_id, epoch)
        .expect("correct epoch release");

    // Recycle with correct epoch, no outstanding borrows.
    ring.recycle_slot_checked(slot_id, epoch)
        .expect("recycle slot");

    // Verify epoch incremented after recycle.
    ring.alloc_write().expect("acquire after recycle");
    let reacquired = ring.slots.iter().find(|s| s.slot_id == slot_id).unwrap();
    assert!(
        reacquired.epoch > epoch,
        "epoch increased: {} > {}",
        reacquired.epoch,
        epoch
    );

    eprintln!(
        "[epoch_safety] PASS (slot {} epoch {} -> {})",
        slot_id, epoch, reacquired.epoch
    );
}

#[test]
fn activation_ring_teardown_stress() {
    // Repeated create/rotations/destroy cycles to verify clean teardown.

    for cycle in 0..10 {
        let mut ring = match tribunus_compute_core::compute_graph::ActivationRing::new(3, 128, 1) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[teardown_stress] cycle {}: ActivationRing::new failed: {} (expected on non-macOS)", cycle, e);
                return;
            }
        };

        for _ in 0..5 {
            if let Some(slot) = ring.alloc_write() {
                let sid = slot.slot_id;
                let ep = slot.epoch;
                ring.mark_ready_for_ane(sid);
                ring.mark_ane_in_flight(sid);
                let _ = ring.release_ane_borrow(sid, ep);
                let _ = ring.recycle_slot_checked(sid, ep);
            }
        }
        drop(ring);
    }
    eprintln!("[teardown_stress] PASS (10 cycles)");
}

#[test]
fn metal_to_coreml_shared_slot_identity() {
    // Proves: Metal writes IOSurface slot → Core ML reads same slot → identity match.
    //
    // Graph topology:
    //   Node 0 (GPU):  write hidden into normed slot (IOSurface-backed)
    //   Node 1 (ANE):  read normed → MLP → mlp_output
    //   Node 2 (CPU):  residual_add = mlp_output + hidden
    //
    // Identity assertions:
    //   metal_receipt.slot_id == coreml_receipt.slot_id
    //   metal_receipt.epoch == coreml_receipt.epoch
    //   metal_receipt.iosurface_id == coreml_receipt.iosurface_id

    let hidden_size = DIM as i64;
    let n = DIM as usize;

    // ── 1. Compile MLP model ───────────────────────────────────────
    let program = build_mlp_program();
    let temp_dir = tempfile::tempdir().unwrap();
    let output_dir = temp_dir.path().join("output");
    fs::create_dir_all(&output_dir).unwrap();
    let compiled = compile_mlpackage(program, "metal_mlp", temp_dir.path(), &output_dir)
        .expect("compile mlpackage");
    let compiled_modelc = compiled.clone();
    let artifact_hash: String = "test-hash".into();

    let mlp_entry = CoreMlArtifactEntry {
        segment_id: "layer_0_mlp".into(),
        artifact_hash: artifact_hash.clone(),
        package_path: String::new(),
        compiled_path: compiled_modelc.to_string_lossy().to_string(),
        compiler_version: String::new(),
        compute_unit_policy: "cpuAndNeuralEngine".into(),
        input_feature_names: vec!["x".into()],
        output_feature_names: vec!["matmul_6".into()],
        input_shapes: vec![vec![1, 128]],
        output_shapes: vec![vec![1, 128]],
        input_dtypes: vec!["float32".into()],
        output_dtypes: vec!["float32".into()],
        weight_references: vec![],
        canonical_provenance: CoreMlProvenance {
            source_tensor_ids: vec![],
            image_hash: "test".into(),
        },
        validation_receipt: tribunus_compute_core::compute_image::CoreMlArtifactReceipt {
            compiled: true,
            loaded: false,
            warmup_passed: false,
            numerical_parity: None,
        },
        graph: None,
    };

    // ── 2. Create custom compute graph ────────────────────────────
    let mut rmsnorm = build_rmsnorm_artifact("cpu:test:rmsnorm", hidden_size);
    rmsnorm.artifact_hash = "rmsnorm_test_hash".into();
    rmsnorm.implementation = CpuImplementation::AccelerateVdsp;

    let mut residual_add = build_residual_add_artifact("cpu:test:residual_add", hidden_size);
    residual_add.artifact_hash = "residual_add_test_hash".into();
    residual_add.implementation = CpuImplementation::AccelerateVdsp;

    let n_bytes = (n * 4) as u64;
    let regions = vec![
        BufferRegion {
            region_id: 0,
            logical_dtype: "float32".into(),
            logical_shape: vec![1, hidden_size],
            byte_length: n_bytes,
            alignment: 64,
            residency: Residency::Host,
            ownership: Ownership::Request,
            alias_group: None,
        },
        BufferRegion {
            region_id: 1,
            logical_dtype: "float32".into(),
            logical_shape: vec![1, hidden_size],
            byte_length: n_bytes,
            alignment: 64,
            residency: Residency::Shared,
            ownership: Ownership::Image,
            alias_group: None,
        },
        BufferRegion {
            region_id: 2,
            logical_dtype: "float32".into(),
            logical_shape: vec![1, hidden_size],
            byte_length: n_bytes,
            alignment: 64,
            residency: Residency::CoreMlCompatible,
            ownership: Ownership::Request,
            alias_group: None,
        },
        BufferRegion {
            region_id: 3,
            logical_dtype: "float32".into(),
            logical_shape: vec![1, hidden_size],
            byte_length: n_bytes,
            alignment: 64,
            residency: Residency::CoreMlCompatible,
            ownership: Ownership::Request,
            alias_group: None,
        },
        BufferRegion {
            region_id: 4,
            logical_dtype: "float32".into(),
            logical_shape: vec![1, hidden_size],
            byte_length: n_bytes,
            alignment: 64,
            residency: Residency::Host,
            ownership: Ownership::Request,
            alias_group: None,
        },
    ];

    let gpu_artifact_id = "metal:test:hidden_copy".to_string();

    let graph = ComputeGraph {
        graph_id: "metal_slot_identity_test:v1".into(),
        graph_version: "0.1.0".into(),
        shape_key: "decode_1".into(),
        regions,
        nodes: vec![
            GraphNode::Dispatch {
                node_id: 0,
                artifact_id: gpu_artifact_id.clone(),
                artifact_hash: "test".into(),
                input_bindings: vec![("x".into(), 0)],
                output_bindings: vec![("out".into(), 2)],
                dependency_ids: vec![],
                lane: LaneAffinity::Gpu,
                failure_policy: FailurePolicy::Degrade,
            },
            GraphNode::Dispatch {
                node_id: 1,
                artifact_id: mlp_entry.segment_id.clone(),
                artifact_hash: mlp_entry.artifact_hash.clone(),
                input_bindings: vec![("x".into(), 2)],
                output_bindings: vec![("matmul_6".into(), 3)],
                dependency_ids: vec![0],
                lane: LaneAffinity::Ane,
                failure_policy: FailurePolicy::Degrade,
            },
            GraphNode::Dispatch {
                node_id: 2,
                artifact_id: residual_add.artifact_id.clone(),
                artifact_hash: residual_add.artifact_hash.clone(),
                input_bindings: vec![("a".into(), 3), ("b".into(), 0)],
                output_bindings: vec![("out".into(), 4)],
                dependency_ids: vec![1],
                lane: LaneAffinity::Cpu,
                failure_policy: FailurePolicy::Degrade,
            },
        ],
        entry_node_ids: vec![0],
        output_node_ids: vec![2],
    };

    // ── 3. Build registry ──────────────────────────────────────────
    let mut registry = ArtifactRegistry::new();
    registry
        .load_coreml_artifact(&mlp_entry)
        .expect("load coreml");
    registry
        .accelerate_artifacts
        .insert(rmsnorm.artifact_id.clone(), rmsnorm);
    registry
        .accelerate_artifacts
        .insert(residual_add.artifact_id.clone(), residual_add);

    // ── 4. Create GraphInstance with PersistentIosurfaceMetalInterop ──
    let hidden: Vec<f32> = (0..n).map(|i| ((i as f32) * 0.1).sin()).collect();
    let norm_weight: Vec<f32> = vec![1.0f32; n];

    // Reference: run MLP via direct predict
    let model = CoreMlModel::load_with_compute_units(
        &compiled_modelc.to_string_lossy(),
        CoreMlComputeUnits::CpuAndNeuralEngine,
    )
    .expect("load model");
    let mut ref_input = hidden.clone();
    let mut ref_output = vec![0.0f32; n];
    let ref_in = ArenaInfo {
        width: hidden_size as i32,
        height: 1,
        logical_dim0: 1,
        logical_dim1: hidden_size as i32,
        pixel_format: 0,
        byte_size: (n * 4) as i32,
        bytes_per_row: (n * 4) as i32,
        base_address: ref_input.as_mut_ptr() as *mut std::ffi::c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };
    let ref_out = ArenaInfo {
        width: hidden_size as i32,
        height: 1,
        logical_dim0: 1,
        logical_dim1: hidden_size as i32,
        pixel_format: 0,
        byte_size: (n * 4) as i32,
        bytes_per_row: (n * 4) as i32,
        base_address: ref_output.as_mut_ptr() as *mut std::ffi::c_void,
        cv_buffer: std::ptr::null_mut(),
        io_surface: std::ptr::null_mut(),
    };
    model
        .predict("x", &ref_in, "matmul_6", &ref_out)
        .expect("reference predict");
    let expected: Vec<f32> = ref_output
        .iter()
        .zip(hidden.iter())
        .map(|(&a, &b)| a + b)
        .collect();

    // ── 5. Graph execution ─────────────────────────────────────────
    let mut inst = GraphInstance::new(&graph, &registry, vec![]);
    inst.set_coreml_buffer_mode(CoreMlBufferMode::PersistentIosurfaceMetalInterop);
    inst.init_persistent_regions(
        &[2, 3, 4],
        Some(CoreMlBufferMode::PersistentIosurfaceMetalInterop),
    )
    .expect("init persistent with metal interop");

    let hidden_bytes = unsafe { std::slice::from_raw_parts(hidden.as_ptr() as *const u8, n * 4) };
    let weight_bytes =
        unsafe { std::slice::from_raw_parts(norm_weight.as_ptr() as *const u8, n * 4) };

    inst.allocate_region(0, Some(hidden_bytes))
        .expect("region 0");
    inst.allocate_region(1, Some(weight_bytes))
        .expect("region 1");
    inst.allocate_region(2, None).expect("region 2");
    inst.allocate_region(3, None).expect("region 3");
    inst.allocate_region(4, None).expect("region 4");

    inst.run().expect("graph run");

    // ── 6. Verify 3 receipts ───────────────────────────────────────
    assert_eq!(inst.node_receipts.len(), 3, "expected 3 receipts");

    let gpu_r = inst
        .node_receipts
        .iter()
        .find(|r| r.lane == "gpu")
        .expect("gpu receipt");
    let ane_r = inst
        .node_receipts
        .iter()
        .find(|r| r.lane == "ane")
        .expect("ane receipt");

    // Verify buffer modes.
    assert_eq!(
        gpu_r.buffer_mode.as_deref(),
        Some("PersistentIosurfaceMetalInterop"),
        "GPU receipt buffer_mode"
    );
    assert_eq!(
        ane_r.buffer_mode.as_deref(),
        Some("PersistentIosurfaceMetalInterop"),
        "ANE receipt buffer_mode"
    );

    // ── 7. Identity proof ──────────────────────────────────────────
    assert_eq!(
        gpu_r.slot_id, ane_r.slot_id,
        "GPU and ANE receipts must share same slot_id: {:?} vs {:?}",
        gpu_r.slot_id, ane_r.slot_id
    );
    assert_eq!(
        gpu_r.slot_epoch, ane_r.slot_epoch,
        "GPU and ANE receipts must share same slot_epoch: {:?} vs {:?}",
        gpu_r.slot_epoch, ane_r.slot_epoch
    );
    assert_eq!(
        gpu_r.iosurface_id, ane_r.iosurface_id,
        "GPU and ANE receipts must share same iosurface_id: {:?} vs {:?}",
        gpu_r.iosurface_id, ane_r.iosurface_id
    );

    eprintln!(
        "[metal_to_coreml] identity: slot_id={:?} epoch={:?} iosurface_id={:?}",
        ane_r.slot_id, ane_r.slot_epoch, ane_r.iosurface_id
    );

    // ── 8. Numerical parity ────────────────────────────────────────
    let output_data = inst.region_data(4).expect("region 4");
    let output_f32: &[f32] = unsafe {
        std::slice::from_raw_parts(output_data.as_ptr() as *const f32, output_data.len() / 4)
    };
    let max_abs = output_f32
        .iter()
        .zip(expected.iter())
        .map(|(&a, &b)| (a as f64 - b as f64).abs())
        .fold(0.0f64, f64::max);
    assert!(
        max_abs < 1e-2,
        "Metal→Core ML output max_abs={:.6e}",
        max_abs
    );

    // ── 9. All routes completed (no fallback) ──────────────────────
    for r in &inst.node_receipts {
        assert_eq!(
            r.route_outcome, "completed",
            "route {} receipt should be completed, got {:?}",
            r.lane, r.route_outcome
        );
        assert!(
            r.allocation_fallback_reason.is_none(),
            "no fallback should occur, got {:?}",
            r.allocation_fallback_reason
        );
    }

    eprintln!("[metal_to_coreml] PASS (max_abs={:.6e})", max_abs);
}
