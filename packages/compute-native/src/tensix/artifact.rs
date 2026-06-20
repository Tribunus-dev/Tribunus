use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TensixComputeArtifact {
    pub format_version: u32,
    pub capability_signature: String,
    pub ir_hash: String,
    pub kernels: Vec<KernelSource>,
    pub compile_flags: Vec<String>,
    pub cb_abi_version: u32,
    pub runtime_args: Vec<RuntimeArgSchema>,
    pub weight_references: Vec<WeightRef>,
    pub tensor_contracts: Vec<TensorContract>,
    pub self_test_vectors: Vec<TestVector>,
    pub evidence_schema_ref: String,
    pub compatibility_rules: CompatibilityRules,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KernelSource {
    pub path: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeArgSchema {
    pub core_x: u32,
    pub core_y: u32,
    pub risc_v_id: u32,
    pub args: Vec<ArgDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArgDescriptor {
    pub name: String,
    pub size_bytes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeightRef {
    pub id: String,
    pub hash: String,
    pub transformed_layout: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TensorContract {
    pub id: String,
    pub logical_shape: Vec<u32>,
    pub physical_tile_layout: String,
    pub data_format: String, // Stringified DType for now, or native tensix format
    pub memory_placement: String, // e.g., "DRAM", "L1"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestVector {
    pub input_hash: String,
    pub expected_output_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompatibilityRules {
    pub breaks_on_capability_deltas: Vec<String>,
}

impl TensixComputeArtifact {
    pub fn new() -> Self {
        Self {
            format_version: 1,
            capability_signature: "".into(),
            ir_hash: "".into(),
            kernels: vec![],
            compile_flags: vec![],
            cb_abi_version: 1,
            runtime_args: vec![],
            weight_references: vec![],
            tensor_contracts: vec![],
            self_test_vectors: vec![],
            evidence_schema_ref: "".into(),
            compatibility_rules: CompatibilityRules {
                breaks_on_capability_deltas: vec![],
            },
            fingerprint: "".into(),
        }
    }

    pub fn compute_fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        // Hash all fields except the fingerprint itself to maintain determinism
        let mut clone = self.clone();
        clone.fingerprint = "".to_string();
        let serialized = serde_json::to_string(&clone).unwrap_or_default();
        hasher.update(serialized.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    pub fn serialize(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn deserialize(data: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialization_roundtrip() {
        let mut artifact = TensixComputeArtifact {
            format_version: 1,
            capability_signature: "Wormhole-v1".into(),
            ir_hash: "abcd123".into(),
            kernels: vec![KernelSource {
                path: "kernel.cpp".into(),
                hash: "deadbeef".into(),
            }],
            compile_flags: vec!["-O3".into()],
            cb_abi_version: 2,
            runtime_args: vec![RuntimeArgSchema {
                core_x: 0,
                core_y: 0,
                risc_v_id: 0,
                args: vec![],
            }],
            weight_references: vec![],
            tensor_contracts: vec![],
            self_test_vectors: vec![],
            evidence_schema_ref: "schema-v1".into(),
            compatibility_rules: CompatibilityRules {
                breaks_on_capability_deltas: vec!["arch".into()],
            },
            fingerprint: "".into(),
        };

        artifact.fingerprint = artifact.compute_fingerprint();

        let json = artifact.serialize().unwrap();
        let deserialized = TensixComputeArtifact::deserialize(&json).unwrap();

        assert_eq!(artifact, deserialized);
        assert_eq!(artifact.fingerprint, deserialized.fingerprint);
    }

    #[test]
    fn test_fingerprint_is_deterministic() {
        let mut artifact = TensixComputeArtifact::new();
        artifact.capability_signature = "test".into();
        let f1 = artifact.compute_fingerprint();
        let f2 = artifact.compute_fingerprint();
        assert_eq!(f1, f2);

        artifact.ir_hash = "different".into();
        let f3 = artifact.compute_fingerprint();
        assert_ne!(f1, f3);
    }
}
