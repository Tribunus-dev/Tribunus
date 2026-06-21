use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TensixManifest {
    pub tt_metalium_version: String,
    pub cpp_library_version: String,
    pub firmware_compatibility_range: String,
    pub build_configuration_flags: Vec<String>,
    pub known_breaking_changes: Vec<String>,
    pub upgrade_procedure: String,
    pub compiler_abi_version: String,
}

impl Default for TensixManifest {
    fn default() -> Self {
        serde_json::from_str(include_str!("manifest.json")).expect("valid manifest.json")
    }
}
