use crate::golden_path::backends::accelerate::AccelerateBackend;
use crate::golden_path::backends::mlx_metal::MlxMetalBackend;
use crate::golden_path::executor::GoldenPathExecutor;
use crate::golden_path::schema::*;

// Computes Mean Absolute Error
fn mae(a: &[f32], b: &[f32]) -> f32 {
    let sum: f32 = a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).sum();
    sum / a.len() as f32
}

#[test]
fn test_conformance_tiny_transformer() {
    let m = 2;
    let k = 128;
    let n = 128;
    let size_a = m * k * 4;
    let size_b = k * n * 4;
    let size_c = m * n * 4;

    let plan = GoldenPathPlan {
        machine_profile: MachineProfile {
            observed_hardware: HardwareProfile {
                cpu_model: "Apple M1".to_string(),
                gpu_metal_family: Some("Apple7".to_string()),
                ram_size_bytes: 16_000_000_000,
            },
            observed_backend_capabilities: BackendCapabilities {
                accelerate_available: true,
                mlx_version: Some("0.0.1".to_string()),
                metal_feature_set: Some("Apple7".to_string()),
            },
            compiler_assumptions: std::collections::HashMap::new(),
        },
        model_graph: ModelGraph {
            architecture: "transformer".to_string(),
            layer_count: 2,
            head_count: 4,
            embedding_dimension: 128,
            quantization_scheme: "f32".to_string(),
            weight_hashes: std::collections::HashMap::new(),
        },
        memory_layout: MemoryLayout {
            weights: size_b,
            activations: size_a,
            kv_cache: 1024,
            scratch: 1024,
            total_size: size_a + size_b + size_c,
        },
        dispatch_table: vec![BlockDescriptor {
            block_id: "matmul_qkv".to_string(),
            processor: "gpu".to_string(),
            backend: "accelerate".to_string(),
            kernel_identity: "hash123".to_string(),
            input_offsets: vec![
                MemoryRange {
                    offset: 0,
                    size: size_a,
                },
                MemoryRange {
                    offset: size_a,
                    size: size_b,
                },
            ],
            output_offsets: vec![MemoryRange {
                offset: size_a + size_b,
                size: size_c,
            }],
            expected_tolerance: 1e-5,
            sync_mask: 0,
            shape: Some(vec![m, k, n]),
        }],
        evidence_ledger: vec![EvidenceLedger {
            block_id: "matmul_qkv".to_string(),
            kernel_source_hash: "hash_src".to_string(),
            compiled_artifact_hash: "hash123".to_string(),
            backend_version: "v0".to_string(),
            metal_feature_set: Some("Apple7".to_string()),
            mlx_version: Some("0.0.1".to_string()),
            qualification_report: None,
        }],
        signature: "valid_sig".to_string(),
    };

    let mut exe_accel = GoldenPathExecutor::new();
    exe_accel.register_backend("accelerate".to_string(), Box::new(AccelerateBackend::new()));
    exe_accel.load(plan.clone()).unwrap();
    exe_accel.initialize().unwrap();

    // Populate island with deterministic pseudo-random float data
    let accel_island = exe_accel.island_mut().unwrap();

    // Safety: memory is properly u32 aligned via IslandRegion struct definition
    unsafe {
        let floats = std::slice::from_raw_parts_mut(
            accel_island.memory.as_mut_ptr() as *mut f32,
            accel_island.memory.len(),
        );
        for (i, v) in floats.iter_mut().enumerate() {
            *v = (i as f32 * 0.1).sin();
        }
    }

    for block in &plan.dispatch_table {
        exe_accel.execute(block).unwrap();
    }

    let audit_accel = exe_accel.finalize();

    // Do same for MLX metal
    let mut mlx_plan = plan.clone();
    mlx_plan.dispatch_table[0].backend = "mlx-metal".to_string();

    let mut exe_mlx = GoldenPathExecutor::new();
    exe_mlx.register_backend("mlx-metal".to_string(), Box::new(MlxMetalBackend::new()));
    exe_mlx.load(mlx_plan.clone()).unwrap();
    exe_mlx.initialize().unwrap();

    // Populate same data
    let mlx_island = exe_mlx.island_mut().unwrap();
    unsafe {
        let floats = std::slice::from_raw_parts_mut(
            mlx_island.memory.as_mut_ptr() as *mut f32,
            mlx_island.memory.len(),
        );
        for (i, v) in floats.iter_mut().enumerate() {
            *v = (i as f32 * 0.1).sin();
        }
    }

    for block in &mlx_plan.dispatch_table {
        exe_mlx.execute(block).unwrap();
    }

    let audit_mlx = exe_mlx.finalize();

    // Retrieve computed output
    let accel_out_mem = &exe_accel.island().unwrap().memory;
    let mlx_out_mem = &exe_mlx.island().unwrap().memory;

    unsafe {
        let out_offset = size_a + size_b;
        let out_words = out_offset / 4;
        let accel_floats = std::slice::from_raw_parts(
            accel_out_mem.as_ptr().add(out_words) as *const f32,
            size_c / 4,
        );
        let mlx_floats = std::slice::from_raw_parts(
            mlx_out_mem.as_ptr().add(out_words) as *const f32,
            size_c / 4,
        );

        let error = mae(accel_floats, mlx_floats);
        assert!(error < 1e-5, "MAE {} exceeds 1e-5", error);
    }
}
