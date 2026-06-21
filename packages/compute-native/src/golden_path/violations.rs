use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum ViolationCode {
    UndeclaredBlock,
    ArtifactHashMismatch,
    ShapeMismatch,
    MemoryOffsetOob,
    MachineProfileMismatch,
    SignatureInvalid,
}

impl fmt::Display for ViolationCode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            ViolationCode::UndeclaredBlock => write!(f, "UNDECLARED_BLOCK"),
            ViolationCode::ArtifactHashMismatch => write!(f, "ARTIFACT_HASH_MISMATCH"),
            ViolationCode::ShapeMismatch => write!(f, "SHAPE_MISMATCH"),
            ViolationCode::MemoryOffsetOob => write!(f, "MEMORY_OFFSET_OOB"),
            ViolationCode::MachineProfileMismatch => write!(f, "MACHINE_PROFILE_MISMATCH"),
            ViolationCode::SignatureInvalid => write!(f, "SIGNATURE_INVALID"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct GoldenPathViolation {
    pub code: ViolationCode,
    pub block_id: Option<String>,
    pub backend: Option<String>,
    pub details: String,
    pub timestamp: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::golden_path::backend::{BackendIdentity, GoldenPathBackend, MemoryView};
    use crate::golden_path::executor::GoldenPathExecutor;
    use crate::golden_path::schema::*;

    struct DummyBackend;
    impl GoldenPathBackend for DummyBackend {
        fn initialize(
            &mut self,
            _plan: &GoldenPathPlan,
            _views: Vec<MemoryView>,
        ) -> Result<(), String> {
            Ok(())
        }
        fn execute(&mut self, _block: &BlockDescriptor) -> Result<AuditEvent, String> {
            Ok(AuditEvent {
                block_id: "dummy".to_string(),
                backend: "dummy".to_string(),
                kernel_identity: "none".to_string(),
                started_at: 0,
                completed_at: 0,
                input_checksum: None,
                output_checksum: None,
                tolerance_met: None,
                error: None,
            })
        }
        fn identity(&self) -> BackendIdentity {
            BackendIdentity {
                name: "dummy".to_string(),
                version: "1.0".to_string(),
            }
        }
    }

    fn create_dummy_plan() -> GoldenPathPlan {
        let block = BlockDescriptor {
            block_id: "block1".to_string(),
            processor: "cpu".to_string(),
            backend: "dummy".to_string(),
            kernel_identity: "hash123".to_string(),
            input_offsets: vec![MemoryRange {
                offset: 0,
                size: 100,
            }],
            output_offsets: vec![],
            expected_tolerance: 1e-5,
            sync_mask: 0,
            shape: Some(vec![10, 10]),
        };

        GoldenPathPlan {
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
                weights: 1000,
                activations: 1000,
                kv_cache: 1000,
                scratch: 1000,
                total_size: 4000,
            },
            dispatch_table: vec![block],
            evidence_ledger: vec![EvidenceLedger {
                block_id: "block1".to_string(),
                kernel_source_hash: "none".to_string(),
                compiled_artifact_hash: "hash123".to_string(),
                backend_version: "1.0".to_string(),
                metal_feature_set: None,
                mlx_version: None,
                qualification_report: None,
            }],
            signature: "valid_sig".to_string(),
        }
    }

    #[test]
    fn test_undeclared_block() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();
        exe.register_backend("dummy".to_string(), Box::new(DummyBackend));
        exe.load(plan.clone()).unwrap();
        exe.initialize().unwrap();

        let mut bad_block = plan.dispatch_table[0].clone();
        bad_block.block_id = "undeclared_block".to_string();

        let res = exe.execute(&bad_block);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::UndeclaredBlock);
    }

    #[test]
    fn test_artifact_hash_mismatch() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();
        exe.register_backend("dummy".to_string(), Box::new(DummyBackend));
        exe.load(plan.clone()).unwrap();
        exe.initialize().unwrap();

        let mut bad_block = plan.dispatch_table[0].clone();
        bad_block.kernel_identity = "invalid_hash".to_string();

        let res = exe.execute(&bad_block);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::ArtifactHashMismatch);
    }

    #[test]
    fn test_shape_mismatch() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();
        exe.register_backend("dummy".to_string(), Box::new(DummyBackend));
        exe.load(plan.clone()).unwrap();
        exe.initialize().unwrap();

        let mut bad_block = plan.dispatch_table[0].clone();
        bad_block.shape = Some(vec![10, 11]);

        let res = exe.execute(&bad_block);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::ShapeMismatch);
    }

    #[test]
    fn test_memory_offset_mismatch() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();
        exe.register_backend("dummy".to_string(), Box::new(DummyBackend));
        exe.load(plan.clone()).unwrap();
        exe.initialize().unwrap();

        let mut bad_block = plan.dispatch_table[0].clone();
        bad_block.input_offsets = vec![MemoryRange {
            offset: 100,
            size: 100,
        }];

        let res = exe.execute(&bad_block);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::MemoryOffsetOob);
    }

    #[test]
    fn test_memory_offset_oob() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();

        // Pass a valid plan but fail when executing a bad block with limits beyond island
        // We will execute a block that is declared but we will pretend to pass one out of bounds in execute directly
        let mut bad_block = plan.dispatch_table[0].clone();
        bad_block.input_offsets = vec![MemoryRange {
            offset: 4000,
            size: 100,
        }];
        // Notice we don't modify the plan here. We modify the block we are attempting to execute.
        // Wait, execute() checks if block.input_offsets != declared_block.input_offsets.
        // If we modify it, it fails with MemoryOffsetOob because it changed from the plan.
        // To specifically test the "out of bounds for island size" check, we should have a plan
        // that has an OOB block and expect `initialize` to fail.
        let mut bad_plan = plan.clone();
        bad_plan.dispatch_table[0].input_offsets = vec![MemoryRange {
            offset: 4000,
            size: 100,
        }];

        exe.register_backend("dummy".to_string(), Box::new(DummyBackend));
        exe.load(bad_plan).unwrap();

        let res = exe.initialize();
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::MemoryOffsetOob);
    }

    #[test]
    fn test_machine_profile_mismatch() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();
        let res = exe.check_machine_profile(&plan, "Intel x86");
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::MachineProfileMismatch);
    }

    #[test]
    fn test_signature_invalid() {
        let mut exe = GoldenPathExecutor::new();
        let plan = create_dummy_plan();
        let res = exe.check_signature(&plan, "wrong_sig");
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().code, ViolationCode::SignatureInvalid);
    }
}
