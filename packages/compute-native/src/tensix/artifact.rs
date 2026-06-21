use crate::tensix::manifest::TensixManifest;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensixComputeArtifact {
    pub manifest: TensixManifest,
    pub fingerprint: String,
    pub payload: Vec<u8>,
}

impl TensixComputeArtifact {
    pub fn new(manifest: TensixManifest, payload: Vec<u8>) -> Self {
        let mut artifact = Self {
            manifest,
            fingerprint: String::new(),
            payload,
        };
        artifact.fingerprint = artifact.calculate_fingerprint();
        artifact
    }

    pub fn calculate_fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        // Hash the manifest JSON
        let json = serde_json::to_string(&self.manifest).unwrap();
        hasher.update(json.as_bytes());
        // Hash the binary payload directly for efficiency
        hasher.update(&self.payload);
        format!("{:x}", hasher.finalize())
    }

    pub fn validate_compatibility(&self, current_manifest: &TensixManifest) -> bool {
        if self.manifest.tt_metalium_version == current_manifest.tt_metalium_version {
            return true;
        }

        // ABI compatibility check
        if self.manifest.compiler_abi_version == current_manifest.compiler_abi_version {
            return true;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_artifact_invalidation() {
        let mut manifest_v1 = TensixManifest::default();
        manifest_v1.tt_metalium_version = "v0.69.0-rc1".into();
        manifest_v1.compiler_abi_version = "1.0.0".into();

        let artifact = TensixComputeArtifact::new(manifest_v1.clone(), vec![1, 2, 3]);

        let mut manifest_v2 = TensixManifest::default();
        manifest_v2.tt_metalium_version = "v0.69.0-rc2".into();
        manifest_v2.compiler_abi_version = "1.1.0".into(); // ABI change

        assert_eq!(artifact.validate_compatibility(&manifest_v2), false);

        let mut manifest_v2_compatible = TensixManifest::default();
        manifest_v2_compatible.tt_metalium_version = "v0.69.0-rc2".into();
        manifest_v2_compatible.compiler_abi_version = "1.0.0".into(); // Same ABI

        assert_eq!(
            artifact.validate_compatibility(&manifest_v2_compatible),
            true
        );
    }
}
