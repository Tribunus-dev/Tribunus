use super::dtype::DType;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum SupportStatus {
    Supported,
    PartiallySupported,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum ImplementationKind {
    NativeMlx,
    ComposedMlx,
    RustReference,
    MetadataOnly,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct OperationEntry {
    pub name: String,
    pub support_status: SupportStatus,
    pub implementation_kind: ImplementationKind,
    pub supported_dtypes: Vec<DType>,
    pub shape_notes: Option<String>,
    pub limitations: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct PlatformSummary {
    pub os: String,
    pub architecture: String,
    pub is_apple: bool,
    pub is_apple_silicon: bool,
    pub metal_available: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct MlxBackendCapabilities {
    pub schema_version: String,
    pub crate_version: String,
    pub git_commit_hash: Option<String>,
    pub enabled_features: Vec<String>,
    pub platform: PlatformSummary,
    pub mlx_runtime_version: Option<String>,
    pub supported_dtypes: Vec<DType>,
    pub supported_devices: Vec<String>,
    pub supported_operations: Vec<OperationEntry>,
    pub known_limitations: Vec<String>,
    // TODO: Add `capability_hash` once canonical serialization rules are defined.
}

impl MlxBackendCapabilities {
    /// Detects and constructs the static capability report dynamically.
    pub fn detect() -> Self {
        Self {
            schema_version: "tribunus.mlx.backend_capabilities.v0".into(),
            crate_version: env!("CARGO_PKG_VERSION").into(),
            git_commit_hash: None,
            enabled_features: vec!["evidence".into()],
            platform: PlatformSummary {
                os: std::env::consts::OS.into(),
                architecture: std::env::consts::ARCH.into(),
                is_apple: std::env::consts::OS == "macos",
                is_apple_silicon: std::env::consts::OS == "macos"
                    && std::env::consts::ARCH == "aarch64",
                metal_available: None,
            },
            mlx_runtime_version: None,
            supported_dtypes: vec![DType::F32],
            supported_devices: vec!["CPU".into()],
            supported_operations: vec![
                OperationEntry {
                    name: "identity".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "constant".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "add".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "multiply".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "matmul".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "reshape".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "transpose".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "sigmoid".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "softmax".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::NativeMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
                OperationEntry {
                    name: "silu".into(),
                    support_status: SupportStatus::Supported,
                    implementation_kind: ImplementationKind::ComposedMlx,
                    supported_dtypes: vec![DType::F32],
                    shape_notes: None,
                    limitations: None,
                },
            ],
            known_limitations: vec!["Canonical hash computation deferred.".into()],
        }
    }
}
